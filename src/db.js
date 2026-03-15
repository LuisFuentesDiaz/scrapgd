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
      url_poster TEXT,
      download_attempts INTEGER DEFAULT 0,
      upload_date TEXT
    );

    CREATE TABLE IF NOT EXISTS vip_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movie_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      source TEXT,
      preview TEXT,
      FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_movies_peliculasgd_url ON movies(peliculasgd_url);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_vip_links_movie_url ON vip_links(movie_id, url);

    DROP VIEW IF EXISTS v_movies_catalog;
    CREATE VIEW v_movies_catalog AS
    SELECT m.title AS name, m.year, m.quality, m.url_poster, v.url, v.source ,v.preview, m.upload_date 
    FROM movies m
    LEFT JOIN vip_links v ON v.movie_id = m.id
    WHERE v.source = 'Google Drive';

    DROP VIEW IF EXISTS v_movies_sin_vip_links;
    CREATE VIEW v_movies_sin_vip_links AS
    SELECT m.id, m.page_number, m.title, m.year, m.quality, m.peliculasgd_url, m.vip_url, m.url_poster, m.download_attempts, m.upload_date
    FROM movies m
    LEFT JOIN vip_links v ON v.movie_id = m.id
    WHERE v.id IS NULL;
  `);


  return db;
}

