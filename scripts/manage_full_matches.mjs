#!/usr/bin/env node
/**
 * Manage the club's encrypted "Full Matches" video list.
 *
 * This is the only place the Google Drive links and the club password ever
 * meet — they are never written to the repo in plain text. Run this locally
 * whenever you add a new week's match, or want to change the club password:
 *
 *   node scripts/manage_full_matches.mjs
 *
 * It decrypts src/data/full-matches.enc.json with the password you type in
 * (nothing is read from a committed file), lets you add a video and/or
 * change the password, then re-encrypts and overwrites that file. The
 * matching decryption happens in the browser on the /full-matches page
 * (src/pages/full-matches.astro), using the Web Crypto API — same
 * PBKDF2 + AES-GCM parameters on both sides.
 *
 * Each video belongs to a league (e.g. FA26-L2) and a week within it —
 * weeks restart at 1 in every league. Videos saved before leagues existed
 * have no league; the script offers to label them when it finds any.
 *
 * Password prompts show "*" for each character typed instead of the real
 * characters.
 */

import { webcrypto } from "node:crypto";
import { createInterface } from "node:readline";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const { subtle } = webcrypto;

// Must match the constants used in src/pages/full-matches.astro.
const KDF_ITERATIONS = 250000;

const DATA_PATH = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"src",
	"data",
	"full-matches.enc.json"
);

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

function bytesToBase64(bytes) {
	return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(b64) {
	return new Uint8Array(Buffer.from(b64, "base64"));
}

// ---------------------------------------------------------------------------
// Crypto: PBKDF2 (password -> key) + AES-GCM (encrypt/decrypt the video list)
// ---------------------------------------------------------------------------

async function deriveKey(password, salt, usages) {
	const keyMaterial = await subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
		"deriveKey",
	]);
	return subtle.deriveKey(
		{ name: "PBKDF2", salt, iterations: KDF_ITERATIONS, hash: "SHA-256" },
		keyMaterial,
		{ name: "AES-GCM", length: 256 },
		false,
		usages
	);
}

async function encryptVideos(password, videos) {
	const salt = webcrypto.getRandomValues(new Uint8Array(16));
	const iv = webcrypto.getRandomValues(new Uint8Array(12));
	const key = await deriveKey(password, salt, ["encrypt"]);
	const ciphertext = await subtle.encrypt(
		{ name: "AES-GCM", iv },
		key,
		new TextEncoder().encode(JSON.stringify(videos))
	);
	return {
		version: 1,
		kdf: { algorithm: "PBKDF2", hash: "SHA-256", iterations: KDF_ITERATIONS },
		salt: bytesToBase64(salt),
		iv: bytesToBase64(iv),
		ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
	};
}

async function decryptVideos(password, payload) {
	const key = await deriveKey(password, base64ToBytes(payload.salt), ["decrypt"]);
	const plaintext = await subtle.decrypt(
		{ name: "AES-GCM", iv: base64ToBytes(payload.iv) },
		key,
		base64ToBytes(payload.ciphertext)
	);
	return JSON.parse(new TextDecoder().decode(plaintext));
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

// One shared interface + async iterator for the whole run. Calling
// rl.question() repeatedly can silently drop lines when multiple answers
// arrive in the same input chunk (a known readline quirk) — pulling lines
// from the async iterator one at a time avoids that.
const rl = createInterface({ input: process.stdin, output: process.stdout });
const lines = rl[Symbol.asyncIterator]();

async function prompt(question) {
	process.stdout.write(question);
	const { value } = await lines.next();
	return (value ?? "").trim();
}

// Same line source as prompt(), but replaces readline's normal echo of
// typed characters with "*" for the duration of this one question — used
// for passwords so the characters themselves never show on screen.
async function promptPassword(question) {
	process.stdout.write(question);
	const originalWriteToOutput = rl._writeToOutput;
	rl._writeToOutput = () => rl.output.write("*");
	try {
		const { value } = await lines.next();
		return (value ?? "").trim();
	} finally {
		rl._writeToOutput = originalWriteToOutput;
		process.stdout.write("\n");
	}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	console.log("=== KICKS Full Matches manager ===\n");

	let payload = null;
	try {
		payload = JSON.parse(await readFile(DATA_PATH, "utf-8"));
	} catch {
		console.log("No existing file found — starting a fresh video list.\n");
	}

	let password;
	if (payload) {
		password = await promptPassword("Club password: ");
	} else {
		// Fresh start, no existing password to verify against — ask twice so a
		// typo doesn't lock the list before it even has anything in it.
		const newPassword = await promptPassword("New club password: ");
		const confirmPassword = await promptPassword("Confirm new club password: ");
		if (!newPassword || newPassword !== confirmPassword) {
			console.error("\nPasswords didn't match (or was empty). Aborting — nothing was saved.");
			process.exitCode = 1;
			return;
		}
		password = newPassword;
	}

	let videos = [];
	if (payload) {
		try {
			videos = await decryptVideos(password, payload);
		} catch {
			console.error("\nThat password didn't decrypt the existing file. Aborting — nothing was changed.");
			process.exitCode = 1;
			return;
		}
	}

	const unlabeled = videos.filter((v) => !v.league);
	if (unlabeled.length > 0) {
		const league = await prompt(
			`\n${unlabeled.length} existing video(s) have no league yet. League to label them with (e.g. FA26-L1, blank to skip): `,
		);
		if (league) {
			for (const v of unlabeled) v.league = league;
			console.log(`Labeled ${unlabeled.length} video(s) as ${league}.`);
		}
	}

	if (videos.length > 0) {
		console.log(`\nCurrent videos (${videos.length}):`);
		for (const v of [...videos].sort((a, b) => b.date.localeCompare(a.date) || b.week - a.week)) {
			console.log(`  ${v.league ? `${v.league} · ` : ""}Week ${v.week} · ${v.date} — ${v.title}`);
		}
	}

	const addAnswer = (await prompt("\nAdd a new video? (Y/n): ")).toLowerCase();
	if (addAnswer !== "n") {
		// Default to the league of the newest video, since that's usually where the next one goes.
		const latestLeague = [...videos].sort((a, b) => b.date.localeCompare(a.date)).find((v) => v.league)?.league;
		const leagueAnswer = await prompt(`League${latestLeague ? ` [${latestLeague}]` : ""}: `);
		const league = leagueAnswer || latestLeague;
		const week = Number(await prompt("Week number (within that league): "));
		const date = await prompt("Date (YYYY-MM-DD): ");
		const title = (await prompt("Title [Full Match]: ")) || "Full Match";
		const driveUrl = await prompt("Google Drive link: ");

		if (!league || !week || !date || !driveUrl) {
			console.error("\nLeague, week, date, and Drive link are all required — nothing was added.");
		} else {
			videos = videos.filter((v) => !(v.league === league && v.week === week));
			videos.push({ league, week, date, title, driveUrl });
			console.log("Added.");
		}
	}

	let finalPassword = password;
	const changeAnswer = (await prompt("\nChange the club password? (y/N): ")).toLowerCase();
	if (changeAnswer === "y") {
		const newPassword = await promptPassword("New password: ");
		const confirmPassword = await promptPassword("Confirm new password: ");
		if (!newPassword || newPassword !== confirmPassword) {
			console.error("\nPasswords didn't match (or was empty) — password was NOT changed.");
		} else {
			finalPassword = newPassword;
			console.log("Password will be changed.");
		}
	}

	const encrypted = await encryptVideos(finalPassword, videos);
	await writeFile(DATA_PATH, JSON.stringify(encrypted, null, 2) + "\n", "utf-8");
	console.log(`\nSaved ${videos.length} video(s) to src/data/full-matches.enc.json`);
}

main().finally(() => rl.close());
