"use client";

import { useMemo, useState } from "react";
import {
  MOVIE_GENRES,
  rankMoviesForGroup,
  searchMovies,
  type Movie,
} from "@/lib/movie-catalogue";

type Props = {
  movies: Movie[];
  currentGenres: string[];
  preferenceMessage: string;
  preferencesByMember: Record<string, string[]>;
  onPreferencesChange(genres: string[]): void;
};

function MovieCard({ movie }: { movie: Movie }) {
  return (
    <article className="flex h-full min-h-44 flex-col rounded-2xl border border-white/[.08] bg-[var(--surface-low)] p-4 transition-colors hover:border-white/[.14]">
      <div className="flex items-start gap-2.5">
        <h4 className="min-w-0 flex-1 break-words text-[15px] font-semibold leading-5 text-[var(--foreground)]">{movie.title}</h4>
        <span className="shrink-0 font-mono text-xs text-[#92949a]">{movie.year}</span>
      </div>
      <p className="mt-3 min-w-0 flex-1 break-words text-sm leading-5 text-[#a5a7aa]">{movie.description}</p>
      <div className="mt-4 flex flex-wrap gap-1.5" aria-label="Genres">
        {movie.genres.map((genre) => (
          <span key={genre} className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-[#b8b9b5]">{genre}</span>
        ))}
      </div>
    </article>
  );
}

export default function MovieDiscovery({
  movies,
  currentGenres,
  preferenceMessage,
  preferencesByMember,
  onPreferencesChange,
}: Props) {
  const [query, setQuery] = useState("");
  const [genreFilter, setGenreFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [section, setSection] = useState<"recommended" | "popular" | "browse">("recommended");
  const availableYears = useMemo(() => [...new Set(movies.map((movie) => movie.year))].sort((a, b) => b - a), [movies]);
  const matchingMovies = useMemo(() => {
    const searched = searchMovies(movies, query);
    return searched
      .filter((movie) => !genreFilter || movie.genres.includes(genreFilter))
      .filter((movie) => !yearFilter || movie.year === Number(yearFilter))
      .sort((a, b) => b.popularity - a.popularity || a.id.localeCompare(b.id));
  }, [genreFilter, movies, query, yearFilter]);
  const rankedMovies = useMemo(() => rankMoviesForGroup(matchingMovies, preferencesByMember), [matchingMovies, preferencesByMember]);
  const popularMovies = matchingMovies.slice(0, 4);
  const recommendations = rankedMovies.slice(0, 6);
  const preferenceCount = Object.values(preferencesByMember).filter((genres) => genres.length > 0).length;
  const shownMovies = section === "recommended" ? recommendations : section === "popular" ? popularMovies : matchingMovies;

  function togglePreference(genre: string) {
    const next = currentGenres.includes(genre)
      ? currentGenres.filter((item) => item !== genre)
      : [...currentGenres, genre];
    onPreferencesChange(next);
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-[var(--surface)] p-4 sm:p-5" aria-labelledby="movie-discovery-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="movie-discovery-heading" className="text-base font-semibold text-[var(--foreground)]">Movie discovery</h2>
          <p className="mt-1 text-xs text-[#92949a]">Find a pick together. Catalogue details do not include streaming links.</p>
        </div>
        <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-full border border-white/10 text-[var(--accent-text)]">✦</span>
      </div>

      <fieldset className="mt-4">
        <legend className="text-xs font-medium text-[#c4c5c6]">Your preferred genres</legend>
        <p className="mt-1 text-[11px] text-[#85878b]">Your choices are saved in this browser and shared with currently online room members.</p>
        {preferenceMessage && <p className="mt-1 text-[11px] text-[#92949a]" role="status">{preferenceMessage}</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          {MOVIE_GENRES.map((genre) => {
            const selected = currentGenres.includes(genre);
            return (
              <label key={genre} className={`cursor-pointer rounded-full border px-2.5 py-1.5 text-xs transition focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--accent-focus)] ${selected ? "border-[var(--accent)]/50 bg-[var(--accent)]/10 text-[var(--accent-text)]" : "border-white/10 text-[#b8b9b5] hover:bg-white/5"}`}>
                <input type="checkbox" checked={selected} onChange={() => togglePreference(genre)} className="sr-only" />
                {genre}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <label htmlFor="movie-title-search" className="sr-only">Search movie titles</label>
        <input id="movie-title-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search titles (typos are okay)" className="w-full rounded-xl border border-white/15 bg-[var(--background)] px-3 py-2.5 text-sm text-white outline-none placeholder:text-[#777980] focus:border-[var(--accent-focus)]/70 focus:ring-2 focus:ring-[var(--accent-focus)]/20" />
        <label className="sr-only" htmlFor="movie-genre-filter">Filter by genre</label>
        <select id="movie-genre-filter" value={genreFilter} onChange={(event) => setGenreFilter(event.target.value)} className="rounded-xl border border-white/15 bg-[var(--background)] px-3 py-2.5 text-sm text-white outline-none focus:border-[var(--accent-focus)]/70 focus:ring-2 focus:ring-[var(--accent-focus)]/20">
          <option value="">All genres</option>
          {MOVIE_GENRES.map((genre) => <option key={genre} value={genre}>{genre}</option>)}
        </select>
        <label className="sr-only" htmlFor="movie-year-filter">Filter by release year</label>
        <select id="movie-year-filter" value={yearFilter} onChange={(event) => setYearFilter(event.target.value)} className="rounded-xl border border-white/15 bg-[var(--background)] px-3 py-2.5 text-sm text-white outline-none focus:border-[var(--accent-focus)]/70 focus:ring-2 focus:ring-[var(--accent-focus)]/20">
          <option value="">All years</option>
          {availableYears.map((year) => <option key={year} value={year}>{year}</option>)}
        </select>
      </div>

      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Movie sections">
        {([
          ["recommended", "Recommended for Your Group"],
          ["popular", "Popular Picks"],
          ["browse", "Browse All"],
        ] as const).map(([key, label]) => (
          <button key={key} type="button" aria-pressed={section === key} onClick={() => setSection(key)} className={`rounded-full border px-3 py-2 text-xs transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-focus)] ${section === key ? "border-[var(--accent)]/40 bg-[var(--accent)]/10 font-medium text-[var(--accent-text)]" : "border-white/10 text-[#b8b9b5] hover:bg-white/5"}`}>{label}</button>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-[#85878b]" role="status">
        {section === "recommended" && preferenceCount === 0 ? "No online genre preferences yet; showing popular picks as your group fallback." : section === "recommended" ? `Preferences from ${preferenceCount} online ${preferenceCount === 1 ? "member" : "members"} are included.` : `${matchingMovies.length} catalogue ${matchingMovies.length === 1 ? "title" : "titles"} match your filters.`}
      </p>
      <h3 className="mt-4 text-sm font-semibold text-[#e7e5de]">{section === "recommended" ? "Recommended for Your Group" : section === "popular" ? "Popular Picks" : "Browse All"}</h3>

      {shownMovies.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-sm text-[#92949a]">No titles match those filters. Try another search or clear a filter.</p>
      ) : (
        <div className="mt-3 grid auto-rows-fr gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {shownMovies.map((movie) => (
            <MovieCard key={movie.id} movie={movie} />
          ))}
        </div>
      )}
    </section>
  );
}
