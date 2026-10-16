import assert from "node:assert/strict";
import test from "node:test";
import { MOVIES, rankMoviesForGroup, sanitizeGenrePreferences, searchMovies } from "../lib/movie-catalogue.ts";

test("movie title search ignores case and matches misspelled words", () => {
  assert.equal(searchMovies(MOVIES, "INCEPTION")[0]?.id, "inception");
  assert.equal(searchMovies(MOVIES, "spidre man")[0]?.id, "into-the-spider-verse");
});

test("group ranking puts member genre matches before popularity fallback", () => {
  const ranked = rankMoviesForGroup(MOVIES, { memberA: ["Romance"], memberB: ["Comedy"] });
  assert.equal(ranked[0]?.id, "palm-springs");
  assert.ok(ranked.findIndex((movie) => movie.id === "inception") > ranked.findIndex((movie) => movie.id === "palm-springs"));
});

test("popularity gives a deterministic fallback when no preferences exist", () => {
  assert.equal(rankMoviesForGroup(MOVIES, {})[0]?.id, "inception");
});

test("preferences are limited to known catalogue genres and duplicates are removed", () => {
  assert.deepEqual(sanitizeGenrePreferences(["Comedy", "Comedy", "not-a-genre", 5]), ["Comedy"]);
  assert.deepEqual(sanitizeGenrePreferences("Comedy"), []);
});
