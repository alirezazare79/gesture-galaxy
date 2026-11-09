# Post LinkedIn — GESTURE GALAXY

> Remplacez `https://alirezazare79.github.io/gesture-galaxy/` et `https://github.com/alirezazare79/gesture-galaxy` avant de publier.
> Conseil : publiez le post **avec la vidéo de démonstration** (voir `DEMO_VIDEO.md`) ; une vidéo native attire bien plus l'œil qu'un simple lien.

---

J'ai fait tourner une galaxie… sans toucher ni la souris, ni le clavier. 🌌✋

Juste ma main, devant la webcam de mon ordinateur portable.

Je vous présente GESTURE GALAXY : une expérience web interactive où des milliers d'étoiles réagissent en temps réel aux mouvements de votre main.

👉 Ouvrez la main : la galaxie se déploie et ses bras spiraux apparaissent.
👉 Fermez le poing : toutes les étoiles sont aspirées vers le noyau, qui s'embrase.
👉 Déplacez la main à gauche ou à droite : la galaxie tourne, au rythme de votre geste.
👉 Montez ou descendez la main : vous changez d'angle de vue.
👉 Pincez le pouce et l'index : une onde de lumière explose à travers tout le disque.

𝗖𝗼𝗺𝗺𝗲𝗻𝘁 ç𝗮 𝗺𝗮𝗿𝗰𝗵𝗲 ?

La webcam filme votre main. Un modèle de vision par ordinateur (MediaPipe, développé par Google) repère 21 points clés de la main : le poignet, chaque articulation, chaque bout de doigt.

À partir de ces points, j'ai écrit la logique qui interprète les gestes : la main est-elle ouverte ? fermée ? les doigts se pincent-ils ? dans quelle direction bouge-t-elle ? Puis ces gestes pilotent une scène 3D animée directement par la carte graphique.

Le plus gros défi n'était pas l'effet visuel, mais la sensation : rendre les gestes fluides et fiables. Lisser les tremblements de la main, éviter qu'un poing soit confondu avec un pincement, déclencher l'explosion une seule fois par pincement, et ne pas tout perdre quand la main sort une seconde du cadre.

🔒 Point important : tout se passe dans le navigateur. Aucune image de la webcam n'est envoyée sur Internet, il n'y a aucun serveur derrière.

Et sans webcam ? L'expérience reste accessible à la souris, au clavier ou au doigt sur mobile.

🛠 Technologies : Three.js · WebGL · MediaPipe Hand Landmarker · TypeScript · Vite · GitHub Pages

🚀 Essayez-la (aucune installation) : https://alirezazare79.github.io/gesture-galaxy/
💻 Le code source est ouvert : https://github.com/alirezazare79/gesture-galaxy

Selon vous, quelle interface pourrait-on piloter un jour avec un simple geste de la main ? 👇

#VisionParOrdinateur #IntelligenceArtificielle #ThreeJS #WebGL #MediaPipe #TypeScript #CreativeCoding #DéveloppementWeb #Innovation #UX

---

## Variante courte (si vous préférez un post plus bref)

Et si vous pouviez contrôler l'univers du bout des doigts ? ✋🌌

J'ai créé GESTURE GALAXY : une galaxie 3D de milliers d'étoiles que l'on pilote avec les mouvements de sa main, détectés par la webcam.

Main ouverte → expansion. Poing fermé → contraction. Pincement → explosion de lumière.

Sous le capot : MediaPipe (le modèle de suivi des mains de Google) repère 21 points de la main, puis ma propre logique traduit ces points en gestes qui animent une scène Three.js / WebGL. Tout tourne dans le navigateur, aucune image ne quitte votre ordinateur.

▶ Démo : https://alirezazare79.github.io/gesture-galaxy/
💻 Code : https://github.com/alirezazare79/gesture-galaxy

Quel geste aimeriez-vous ajouter ? 👇

#VisionParOrdinateur #ThreeJS #MediaPipe #CreativeCoding #WebGL
