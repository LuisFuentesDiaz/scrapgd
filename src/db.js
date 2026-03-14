import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const DB_FILE = 'scrapgd.db';

/**
 * Abre (o crea) la base de datos y asegura el esquema necesario.
 * @returns {Promise<import('sqlite').Database>}
 */
export async function getDb() {
  const db = await open({
    filename: DB_FILE,
    driver: sqlite3.Database,
  });

  await db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS movies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_number INTEGER,
      title TEXT,
      year TEXT,
      quality TEXT,
      peliculasgd_url TEXT UNIQUE,
      vip_url TEXT,
      poster_url TEXT
    );

    CREATE TABLE IF NOT EXISTS vip_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movie_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      fuente TEXT,
      preview TEXT,
      FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_movies_peliculasgd_url ON movies(peliculasgd_url);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_vip_links_movie_url ON vip_links(movie_id, url);

    DROP VIEW IF EXISTS v_movies_catalog;
    CREATE VIEW v_movies_catalog AS
    SELECT m.title AS name, m.year, m.quality, m.poster_url, v.url, v.fuente, v.preview
    FROM movies m
    LEFT JOIN vip_links v ON v.movie_id = m.id
    where v.fuente = 'Google Drive';

    DROP VIEW IF EXISTS v_movies_sin_vip_links;
    CREATE VIEW v_movies_sin_vip_links AS
    SELECT m.id, m.page_number, m.title, m.year, m.quality, m.peliculasgd_url, m.vip_url, m.poster_url
    FROM movies m
    LEFT JOIN vip_links v ON v.movie_id = m.id
    WHERE v.id IS NULL;
  `);

  // Migración: añadir columnas en BDs ya existentes
  await db.exec('ALTER TABLE movies ADD COLUMN poster_url TEXT').catch(() => {});
  await db.exec('ALTER TABLE vip_links ADD COLUMN fuente TEXT').catch(() => {});
  await db.exec('ALTER TABLE vip_links ADD COLUMN preview TEXT').catch(() => {});

  return db;
}

