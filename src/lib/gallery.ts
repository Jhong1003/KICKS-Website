// Gallery albums. Photos live in one folder per album:
//
//   src/assets/gallery/<album-id>/*.jpg|jpeg|png|webp
//
// and src/data/gallery-albums.json (hand-edited) gives each album its title,
// Korean title, date and optional cover. A folder that isn't listed in the
// JSON still shows up (titled by its folder name), so dropping a new folder
// in never hides photos; an album listed in the JSON with no photos is
// skipped. Albums are shown newest first by `date` (undated ones last).
//
// Inside an album, files sort by name with numbers in natural order
// (1, 2, ... 10), so prefix 01-, 02-, ... or plain numbers to control order.
// A descriptive file name becomes the alt text; a bare number becomes
// "KICKS futsal photo 7".

import heroImage from "../assets/hero.jpg";
import aboutImage from "../assets/about.jpg";
import albumsData from "../data/gallery-albums.json";

export interface GalleryImage {
	src: ImageMetadata;
	alt: string;
}

export interface GalleryAlbum {
	id: string;
	title: string;
	titleKo: string;
	date: string | null;
	images: GalleryImage[];
	cover: GalleryImage;
}

interface AlbumEntry {
	id: string;
	title?: string;
	title_ko?: string;
	date?: string;
	/** File name inside the album folder to use as the cover (default: the first photo). */
	cover?: string;
	/** Also show the homepage hero and About photos at the end (they came from this shoot). */
	site_photos?: boolean;
}

const modules = import.meta.glob<{ default: ImageMetadata }>("/src/assets/gallery/*/*.{jpg,jpeg,png,webp,JPG,JPEG,PNG,WEBP}", {
	eager: true,
});

const entries = albumsData as AlbumEntry[];

function altFor(fileName: string): string {
	const base = fileName.replace(/\.[^.]+$/, "");
	return /^\d+$/.test(base) ? `KICKS futsal photo ${base}` : base.replace(/[-_]/g, " ");
}

function buildAlbums(): GalleryAlbum[] {
	const files = new Map<string, { name: string; src: ImageMetadata }[]>();
	for (const [path, mod] of Object.entries(modules)) {
		const [, , , , folder, name] = path.split("/");
		if (!files.has(folder)) files.set(folder, []);
		files.get(folder)!.push({ name, src: mod.default });
	}

	const ids = [...new Set([...entries.map((entry) => entry.id), ...files.keys()])];
	const albums = ids.flatMap((id): GalleryAlbum[] => {
		const entry = entries.find((candidate) => candidate.id === id);
		const photos = (files.get(id) ?? []).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
		const images: GalleryImage[] = photos.map((photo) => ({ src: photo.src, alt: altFor(photo.name) }));
		if (entry?.site_photos) {
			images.push({ src: heroImage, alt: "KICKS players in action" }, { src: aboutImage, alt: "KICKS club members playing futsal" });
		}
		if (images.length === 0) return [];
		const coverIndex = entry?.cover ? photos.findIndex((photo) => photo.name === entry.cover) : -1;
		return [
			{
				id,
				title: entry?.title ?? id,
				titleKo: entry?.title_ko ?? entry?.title ?? id,
				date: entry?.date ?? null,
				images,
				cover: images[Math.max(0, coverIndex)],
			},
		];
	});

	return albums.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

export const albums = buildAlbums();
