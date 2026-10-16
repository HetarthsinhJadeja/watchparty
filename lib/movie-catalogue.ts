export type Movie = {
  id: string;
  title: string;
  genres: string[];
  year: number;
  description: string;
  popularity: number;
};

export const MOVIE_GENRES = [
  "Action",
  "Adventure",
  "Animation",
  "Comedy",
  "Crime",
  "Drama",
  "Fantasy",
  "Horror",
  "Mystery",
  "Romance",
  "Sci-Fi",
  "Thriller",
] as const;

// A small hand-curated catalogue. Descriptions are original summaries; these
// entries provide discovery metadata only and intentionally include no streams.
export const MOVIES: Movie[] = [
  { id: "inception", title: "Inception", genres: ["Sci-Fi", "Action", "Thriller"], year: 2010, description: "A specialist assembles a team for a heist carried out inside layered dreams.", popularity: 98 },
  { id: "the-dark-knight", title: "The Dark Knight", genres: ["Action", "Crime", "Drama"], year: 2008, description: "A masked protector faces a criminal who turns a city against itself.", popularity: 97 },
  { id: "spirited-away", title: "Spirited Away", genres: ["Animation", "Fantasy", "Adventure"], year: 2001, description: "A resourceful child navigates a mysterious spirit world to reunite her family.", popularity: 94 },
  { id: "parasite", title: "Parasite", genres: ["Drama", "Thriller", "Comedy"], year: 2019, description: "Two households become entangled as one family finds work in another's home.", popularity: 95 },
  { id: "arrival", title: "Arrival", genres: ["Sci-Fi", "Drama", "Mystery"], year: 2016, description: "A linguist works to understand visitors whose language reshapes how time is seen.", popularity: 89 },
  { id: "get-out", title: "Get Out", genres: ["Horror", "Mystery", "Thriller"], year: 2017, description: "A weekend visit grows unsettling as a guest notices strange behavior around him.", popularity: 91 },
  { id: "mad-max-fury-road", title: "Mad Max: Fury Road", genres: ["Action", "Adventure", "Sci-Fi"], year: 2015, description: "A desert escape becomes a high-speed fight for freedom and survival.", popularity: 93 },
  { id: "everything-everywhere", title: "Everything Everywhere All at Once", genres: ["Sci-Fi", "Action", "Comedy"], year: 2022, description: "A family laundromat owner discovers unexpected versions of her life across many worlds.", popularity: 90 },
  { id: "knives-out", title: "Knives Out", genres: ["Mystery", "Comedy", "Crime"], year: 2019, description: "A sharp detective questions a wealthy family after a writer's death.", popularity: 88 },
  { id: "palm-springs", title: "Palm Springs", genres: ["Comedy", "Romance", "Fantasy"], year: 2020, description: "Two wedding guests find themselves reliving the same sunny celebration.", popularity: 82 },
  { id: "into-the-spider-verse", title: "Spider-Man: Into the Spider-Verse", genres: ["Animation", "Action", "Adventure"], year: 2018, description: "A Brooklyn teenager meets heroes from other worlds and finds his own way forward.", popularity: 92 },
  { id: "the-grand-budapest-hotel", title: "The Grand Budapest Hotel", genres: ["Comedy", "Adventure", "Crime"], year: 2014, description: "A concierge and his protégé race through a caper involving a disputed painting.", popularity: 86 },
  { id: "interstellar", title: "Interstellar", genres: ["Sci-Fi", "Adventure", "Drama"], year: 2014, description: "A crew searches beyond Earth for a future while one family waits at home.", popularity: 96 },
  { id: "moonlight", title: "Moonlight", genres: ["Drama", "Romance"], year: 2016, description: "Three chapters follow a young man's search for connection and self-understanding.", popularity: 84 },
  { id: "the-thing", title: "The Thing", genres: ["Horror", "Mystery", "Sci-Fi"], year: 1982, description: "A remote research team struggles to trust one another after a discovery in the ice.", popularity: 80 },
  { id: "coco", title: "Coco", genres: ["Animation", "Adventure", "Fantasy"], year: 2017, description: "A young musician journeys through a colorful afterlife to learn about his family.", popularity: 87 },
  { id: "before-sunrise", title: "Before Sunrise", genres: ["Romance", "Drama"], year: 1995, description: "Two travelers spend one night walking and talking through a European city.", popularity: 78 },
  { id: "edge-of-tomorrow", title: "Edge of Tomorrow", genres: ["Sci-Fi", "Action"], year: 2014, description: "A soldier repeats the same battle and learns how to change its outcome.", popularity: 85 },
];

export function sanitizeGenrePreferences(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<string>(MOVIE_GENRES);
  return [...new Set(value.filter((genre): genre is string => typeof genre === "string" && allowed.has(genre)))];
}

function normalize(value: string) {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

function editDistance(left: string, right: string) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = row[0];
    row[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const previous = row[rightIndex];
      row[rightIndex] = Math.min(
        row[rightIndex] + 1,
        row[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = previous;
    }
  }
  return row[right.length];
}

function fuzzyTitleMatch(query: string, title: string) {
  const normalizedQuery = normalize(query);
  const normalizedTitle = normalize(title);
  if (normalizedTitle.includes(normalizedQuery)) return true;
  const queryWords = normalizedQuery.split(" ").filter(Boolean);
  const titleWords = normalizedTitle.split(" ");
  return queryWords.every((word) => titleWords.some((titleWord) => {
    const threshold = word.length < 5 ? 1 : Math.max(1, Math.round(word.length * 0.3));
    return Math.abs(word.length - titleWord.length) <= threshold && editDistance(word, titleWord) <= threshold;
  }));
}

export function searchMovies(movies: Movie[], query: string) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [...movies];
  return movies.filter((movie) => fuzzyTitleMatch(normalizedQuery, movie.title));
}

export function rankMoviesForGroup(movies: Movie[], preferencesByMember: Record<string, string[]>) {
  const preferences = Object.values(preferencesByMember).filter((genres) => genres.length > 0);
  return [...movies].sort((left, right) => {
    const leftMatches = preferences.filter((genres) => genres.some((genre) => left.genres.includes(genre))).length;
    const rightMatches = preferences.filter((genres) => genres.some((genre) => right.genres.includes(genre))).length;
    return rightMatches - leftMatches || right.popularity - left.popularity || left.id.localeCompare(right.id);
  });
}
