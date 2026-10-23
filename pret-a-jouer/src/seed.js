// Fills the database with fictional demo lenders around a point, so the map
// is not empty on first launch. Usage: npm run seed -- [lat] [lng]
import { randomBytes, scryptSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb } from './db.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const db = openDb(process.env.DB_FILE || join(root, 'data', 'pret-a-jouer.sqlite'));
const [lat0 = 48.8566, lng0 = 2.3522] = process.argv.slice(2).map(Number);

const lenders = [
  ['Camille (démo)', 'Maman de deux loulous, on fait tourner les jouets !', [
    ['Duplo grande boîte', 'Environ 150 pièces, avec la ferme et les animaux.', 'Construction', 1, 5, 'très bon', 0, 21],
    ['Trotteur en bois', 'Avec cubes à empiler, roues silencieuses.', 'Éveil bébé', 0, 2, 'bon', 10, 30],
  ]],
  ['Mehdi (démo)', 'Collection de jeux de société, tous complets.', [
    ['Dixit', 'Jeu complet, cartes protégées.', 'Jeux de société', 8, 18, 'comme neuf', 0, 14],
    ['Les Aventuriers du Rail', 'Version Europe, toutes les pièces.', 'Jeux de société', 8, 18, 'très bon', 15, 14],
    ['Puzzle 1000 pièces Paris', 'Vérifié, aucune pièce manquante.', 'Puzzles', 10, 18, 'bon', 0, 30],
  ]],
  ['Sophie (démo)', 'Nos enfants ont grandi, autant que ça serve !', [
    ['Draisienne 12 pouces', 'Selle réglable, idéale pour apprendre l’équilibre.', 'Plein air', 2, 5, 'bon', 20, 14],
    ['Costume de pompier', 'Taille 4-6 ans, avec casque.', 'Déguisements', 4, 6, 'très bon', 0, 7],
  ]],
  ['Lucas (démo)', '', [
    ['Circuit de train en bois', '40 rails, 2 locomotives, un pont.', 'Véhicules', 3, 8, 'bon', 10, 21],
    ['Xylophone', 'Lames métalliques colorées.', 'Musique', 1, 5, 'usé', 0, 14],
  ]],
  ['Inès (démo)', 'Prêts à la sortie de l’école le mercredi.', [
    ['Maison de poupée', 'Avec mobilier et 4 personnages.', 'Poupées & figurines', 3, 9, 'très bon', 25, 21],
    ['Kapla 200 planchettes', 'Dans sa caisse en bois.', 'Construction', 4, 12, 'bon', 15, 21],
    ['Lot de 10 albums', 'Albums illustrés pour 3-6 ans.', 'Livres', 3, 6, 'bon', 0, 30],
  ]],
];

const salt = randomBytes(16).toString('hex');
const hash = scryptSync(randomBytes(12).toString('hex'), salt, 64).toString('hex');

lenders.forEach(([name, bio, toys], i) => {
  const angle = (i / lenders.length) * 2 * Math.PI + 0.4;
  const km = 0.6 + i * 0.9;
  const lat = lat0 + (km * Math.cos(angle)) / 111.32;
  const lng = lng0 + (km * Math.sin(angle)) / (111.32 * Math.cos((lat0 * Math.PI) / 180));
  const email = `demo${i + 1}@pret-a-jouer.invalid`;
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return;
  const { lastInsertRowid: uid } = db.prepare(
    'INSERT INTO users (name, email, pass_hash, salt, lat, lng, city, bio) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(name, email, hash, salt, lat, lng, '', bio);
  for (const [title, description, category, ageMin, ageMax, condition, deposit, maxDays] of toys) {
    db.prepare(`INSERT INTO toys (owner_id, title, description, category, age_min, age_max, condition, deposit, max_days)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(uid, title, description, category, ageMin, ageMax, condition, deposit, maxDays);
  }
});

console.log(`Prêteurs de démonstration ajoutés autour de ${lat0}, ${lng0}.`);
