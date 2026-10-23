# Prêt'à Jouer

Application web de prêt de jouets entre particuliers, avec une carte des prêteurs autour de soi.

## Fonctionnalités

- **Carte des prêteurs** (OpenStreetMap + Leaflet) : un repère par prêteur, avec le nombre de jouets proposés, et un cercle qui montre le rayon de recherche.
- **Géolocalisation** : bouton « Me localiser » (GPS du téléphone ou position du navigateur) ou recherche d'une adresse ou d'une ville.
- **Recherche** par mot-clé, catégorie, âge de l'enfant, rayon (1 à 30 km) et disponibilité immédiate. Les résultats sont triés par distance.
- **Vie privée** : l'adresse exacte d'un prêteur n'est jamais transmise. Les autres membres voient un point décalé de 150 à 400 m, toujours le même pour un prêteur donné.
- **Mes jouets** : photo (réduite dans le navigateur avant l'envoi), description, tranche d'âge, état, durée maximale du prêt, caution éventuelle, visibilité.
- **Prêts** : demande avec dates et message → acceptée ou refusée → jouet remis → jouet rendu. Les réservations qui se chevauchent sont refusées.
- **Messagerie** propre à chaque demande pour convenir du rendez-vous.
- **Avis** (1 à 5 étoiles) après le retour du jouet, affichés sur la fiche du prêteur.
- Interface responsive, avec une barre d'onglets en bas de l'écran sur téléphone, et mode sombre automatique.

## Lancer l'application

Il faut Node.js 22.5 ou plus récent (la base SQLite est intégrée à Node, aucune dépendance à installer).

```bash
cd pret-a-jouer
npm run seed     # facultatif : ajoute 5 prêteurs fictifs « (démo) » autour de Paris
npm start
```

Puis ouvrir `http://localhost:8790`.

Pour placer les prêteurs de démonstration autour d'une autre ville : `npm run seed -- 45.764 4.8357` (latitude, longitude ; ici Lyon).

Variables d'environnement facultatives :

| Variable | Rôle | Par défaut |
| --- | --- | --- |
| `PORT` | Port HTTP | `8790` |
| `DB_FILE` | Fichier SQLite | `data/pret-a-jouer.sqlite` |
| `FUZZ_SECRET` | Clé qui sert à décaler les positions affichées | générée et stockée dans la base |

## Tests

```bash
npm test
```

Les tests couvrent le cycle complet d'un prêt entre deux voisins (recherche par distance, filtres, dates qui se chevauchent, statuts, avis) et le décalage des positions.

## Mise en ligne

La géolocalisation des navigateurs ne fonctionne qu'en **HTTPS** (ou sur `localhost`). En production, placer l'application derrière un proxy HTTPS (Caddy, Nginx, ou un hébergeur comme Render ou Railway).

La recherche d'adresse passe par le service Nominatim d'OpenStreetMap, limité à un usage modéré. Pour un trafic important, utiliser un fournisseur de géocodage dédié.

## Structure

```
src/server.js   démarrage du serveur HTTP
src/app.js      API (comptes, jouets, prêts, messages, avis, géocodage) et fichiers statiques
src/geo.js      distances, zone de recherche, décalage des positions
src/db.js       schéma SQLite
src/seed.js     données de démonstration
public/         interface (HTML, CSS, JS) et Leaflet fourni localement
test/           tests de l'API
```
