import { leagues } from "./leagues";
import { albums } from "./gallery";

const seasonOf = (id: string) => id.split("-")[0].toUpperCase();
export const seasons = [...new Set([
    ...leagues.map((league) => seasonOf(league.id)),
    ...albums.map((album) => seasonOf(album.id)).filter((id) => /^(SP|SU|FA|WI)\d{2}$/.test(id)),
])].sort((a, b) => Number(b.slice(2)) - Number(a.slice(2)) || ["WI", "FA", "SU", "SP"].indexOf(a.slice(0, 2)) - ["WI", "FA", "SU", "SP"].indexOf(b.slice(0, 2)));
export const seasonLeagues = (season: string) => leagues.filter((league) => seasonOf(league.id) === season);
export const seasonAlbums = (season: string) => albums.filter((album) => seasonOf(album.id) === season);
