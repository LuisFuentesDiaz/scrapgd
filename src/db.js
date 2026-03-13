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
      vip_url TEXT
    );

    CREATE TABLE IF NOT EXISTS vip_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movie_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_movies_peliculasgd_url ON movies(peliculasgd_url);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_vip_links_movie_url ON vip_links(movie_id, url);
  `);

  return db;
}

