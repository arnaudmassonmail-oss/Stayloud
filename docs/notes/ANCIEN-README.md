# STAYLOUD v6.0 — recherche metal + photos datées

Cette version conserve le moteur concerts et les extraits musicaux de la version fournie. Les changements portent uniquement sur l’identification des groupes et la sélection des photos.

- Recherche groupe prioritairement sur The Metal Archives et Spirit of Metal, puis MusicBrainz/Bandsintown en complément.
- Désambiguïsation renforcée : pays, localisation, style, source et identité sont conservés.
- Les homonymes peuvent être enregistrés comme identités distinctes.
- Photos : mélange live, studio, promotionnelles et pochettes pertinentes.
- Date de publication/prise de vue recherchée quand elle est disponible et utilisée comme critère principal.
- « 5 autres photos » exclut les photos déjà proposées et produit une nouvelle série.

Le reste du projet est conservé tel quel.
# STAYLOUD 5.3

Application locale de radar musical.

## Moteur des concerts

Le calendrier des groupes suivis utilise **uniquement** :

- Bandsintown
- InfoConcert

Le moteur ne consulte plus les autres sources de concerts des anciennes versions.

### Règles

- Une date doit contenir une date, une ville et une salle.
- La clé de fusion est `date + ville + salle`.
- Les différences de casse, accents et ponctuation sont normalisées.
- Si les deux sources décrivent le même concert, une seule fiche est affichée et les deux références sont conservées.
- Si au moins une source répond avec des dates exploitables, le calendrier est synchronisé sur les résultats des deux sources disponibles.
- Si les deux sources sont indisponibles, le dernier calendrier est conservé.
- Au premier démarrage en 5.3, les anciens événements des moteurs précédents sont supprimés.

## Installation

```powershell
npm install
npm start
```

Puis ouvrir `http://localhost:8787`.

## Test conseillé

Ajouter/actualiser :

- Rise Of The Northstar
- Emmure
- Black Bomb A

Le moteur doit montrer les dates provenant de Bandsintown et/ou InfoConcert, sans conserver les anciens faux positifs issus des versions précédentes.


## 5.3 — corrections de collecte

- Bandsintown reste la source principale pour le calendrier international.
- La page publique Bandsintown n'affiche qu'un sous-ensemble des dates : le moteur avance désormais dans le calendrier avec `startDate` sur la même page Bandsintown jusqu'à épuisement des dates à venir.
- InfoConcert est conservé comme seconde source et son parseur accepte une structure de page plus large afin de récupérer notamment les dates comme Quai M.
- Aucune autre source de concerts n'est utilisée.
