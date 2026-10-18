export interface ModelItem {
  id: string;
  name: string;
  url: string;
  /** Size multiplier (default 1). Boxy mascots have a body far bigger than their hip-to-shoulder distance, which is what the outfit is sized by */
  scale?: number;
}

export interface CategoryDefinition {
  id: string;
  name: string;
  tagline: string;
  icon: string;
  accentColor: string;
  /** Full-frame transparent PNG drawn over the mirror (and into the photo) while this collection is worn */
  stickers: string;
  models: ModelItem[];
}

export const CATEGORIES: CategoryDefinition[] = [
  {
    id: "spiderman",
    name: "Spider-Verse",
    tagline: "Multiverse wall-crawlers & web-slingers",
    icon: "🕷️",
    accentColor: "#ef4444",
    stickers: "/assets/stickers/spiderman.png",
    models: [
      { id: "spiderman", name: "Spider-Man", url: "/assets/costumes/spiderman/SpiderMan.vrm" },
      { id: "miles", name: "Miles Morales", url: "/assets/costumes/spiderman/Miles.vrm" },
      { id: "spiderman_raimi", name: "Spider-Man (2004)", url: "/assets/costumes/spiderman/SpiderManRaimi.vrm" },
      { id: "spiderman_2099", name: "Spider 2099", url: "/assets/costumes/spiderman/Spider2099.vrm" }
    ]
  },
  {
    id: "spiderman_2",
    name: "Spider-Verse II",
    tagline: "More spider-heroes from across the multiverse",
    icon: "🕸️",
    accentColor: "#ef4444",
    stickers: "/assets/stickers/spiderman_2.png",
    models: [
      { id: "mayday_parker", name: "Mayday Parker", url: "/assets/costumes/spiderman/MaydayParker.vrm" },
      { id: "spiderman", name: "Spider-Man", url: "/assets/costumes/spiderman/SpiderMan.vrm" },
      { id: "miles", name: "Miles Morales", url: "/assets/costumes/spiderman/Miles.vrm" },
      { id: "spiderman_2099", name: "Spider 2099", url: "/assets/costumes/spiderman/Spider2099.vrm" }
    ]
  },
  {
    id: "minecraft",
    name: "Minecraft World",
    tagline: "Blocky survival pioneers & monsters",
    icon: "⛏️",
    accentColor: "#22c55e",
    stickers: "/assets/stickers/minecraft.png",
    models: [
      { id: "mc_steve", name: "Steve", url: "/assets/costumes/minecraft/Player.vrm" },
      { id: "mc_alex", name: "Alex", url: "/assets/costumes/minecraft/Alex.vrm" },
      { id: "mc_zombie", name: "Zombie", url: "/assets/costumes/minecraft/Zombie.vrm" },
      { id: "mc_skeleton", name: "Skeleton", url: "/assets/costumes/minecraft/Skeleton.vrm" }
    ]
  },
  {
    id: "minecraft_mobs",
    name: "Minecraft Mobs",
    tagline: "Creatures of the night & the deep dark",
    icon: "🧟",
    accentColor: "#22c55e",
    stickers: "/assets/stickers/minecraft_mobs.png",
    models: [
      { id: "mc_enderman", name: "Enderman", url: "/assets/costumes/minecraft/Enderman.vrm" },
      { id: "mc_warden", name: "Warden", url: "/assets/costumes/minecraft/Warden.vrm" },
      { id: "mc_zombie", name: "Zombie", url: "/assets/costumes/minecraft/Zombie.vrm" },
      { id: "mc_skeleton", name: "Skeleton", url: "/assets/costumes/minecraft/Skeleton.vrm" }
    ]
  },
  {
    id: "spongebob",
    name: "Bikini Bottom",
    tagline: "Undersea comedy crew & fry cooks",
    icon: "🍍",
    accentColor: "#facc15",
    stickers: "/assets/stickers/spongebob.png",
    models: [
      { id: "spongebob", name: "SpongeBob", url: "/assets/costumes/spongebob/SpongeBob.vrm", scale: 0.5 },
      { id: "patrick", name: "Patrick Star", url: "/assets/costumes/spongebob/Patrick.vrm" },
      { id: "mr_krabs", name: "Mr. Krabs", url: "/assets/costumes/spongebob/MrKrabs.vrm" }
    ]
  },
  {
    id: "sonic",
    name: "Sonic & Rivals",
    tagline: "Super-sonic hedgehogs & villainous minds",
    icon: "🦔",
    accentColor: "#3b82f6",
    stickers: "/assets/stickers/sonic.png",
    models: [
      { id: "sonic", name: "Sonic", url: "/assets/costumes/sonic/SonicHD.vrm" },
      { id: "shadow", name: "Shadow", url: "/assets/costumes/sonic/Shadow.vrm" },
      { id: "knuckles", name: "Knuckles", url: "/assets/costumes/sonic/Knuckles.vrm" },
      { id: "eggman", name: "Dr. Eggman", url: "/assets/costumes/sonic/Eggman.vrm" }
    ]
  },
  {
    id: "sonic_2",
    name: "Sonic & Friends",
    tagline: "Hammer-swinging heroes & metal doppelgängers",
    icon: "💍",
    accentColor: "#3b82f6",
    stickers: "/assets/stickers/sonic_2.png",
    models: [
      { id: "amy_rose", name: "Amy Rose", url: "/assets/costumes/sonic/AmyRose.vrm" },
      { id: "metal_sonic", name: "Metal Sonic", url: "/assets/costumes/sonic/MetalSonic.vrm" },
      { id: "sonic", name: "Sonic", url: "/assets/costumes/sonic/SonicHD.vrm" },
      { id: "knuckles", name: "Knuckles", url: "/assets/costumes/sonic/Knuckles.vrm" }
    ]
  },
  {
    id: "fnaf",
    name: "Freddy's Pizzeria",
    tagline: "Mechanical night-shift legends",
    icon: "🐻",
    accentColor: "#a855f7",
    stickers: "/assets/stickers/fnaf.png",
    models: [
      { id: "freddy", name: "Freddy Fazbear", url: "/assets/costumes/fnaf/Freddy.vrm" },
      { id: "bonnie", name: "Bonnie", url: "/assets/costumes/fnaf/Bonnie.vrm" },
      { id: "chica", name: "Chica", url: "/assets/costumes/fnaf/Chica.vrm" },
      { id: "toy_freddy", name: "Toy Freddy", url: "/assets/costumes/fnaf/ToyFreddy.vrm" }
    ]
  },
  {
    id: "fnaf_2",
    name: "Freddy's Pizzeria II",
    tagline: "Circus animatronics & digital nightmares",
    icon: "🎪",
    accentColor: "#a855f7",
    stickers: "/assets/stickers/fnaf_2.png",
    models: [
      { id: "circus_baby", name: "Circus Baby", url: "/assets/costumes/fnaf/CircusBaby.vrm" },
      { id: "funtime_foxy", name: "Funtime Foxy", url: "/assets/costumes/fnaf/FuntimeFoxy.vrm" },
      { id: "glitchtrap", name: "Glitchtrap", url: "/assets/costumes/fnaf/Glitchtrap.vrm" },
      { id: "marionette", name: "Marionette", url: "/assets/costumes/fnaf/Marionette.vrm" }
    ]
  },
  {
    id: "anime_legends",
    name: "Anime Titans",
    tagline: "Jujutsu sorcerers & Grand Line swordsmen",
    icon: "⚔️",
    accentColor: "#f97316",
    stickers: "/assets/stickers/anime_legends.png",
    models: [
      { id: "gojo", name: "Gojo Satoru", url: "/assets/costumes/jujutsu_kaisen/Gojo.vrm" },
      { id: "sukuna", name: "Ryomen Sukuna", url: "/assets/costumes/jujutsu_kaisen/Sukuna.vrm" },
      { id: "zoro", name: "Roronoa Zoro", url: "/assets/costumes/one_piece/Zoro.vrm" }
    ]
  },
  {
    id: "anime_legends_2",
    name: "Anime Titans II",
    tagline: "Cursed rivals of Jujutsu High",
    icon: "🌀",
    accentColor: "#f97316",
    stickers: "/assets/stickers/anime_legends_2.png",
    models: [
      { id: "geto", name: "Suguru Geto", url: "/assets/costumes/jujutsu_kaisen/Geto.vrm" },
      { id: "choso", name: "Choso", url: "/assets/costumes/jujutsu_kaisen/Choso.vrm" }
    ]
  },
  {
    id: "cartoons",
    name: "Cartoon Pals",
    tagline: "Elmore & Ooo dimensional explorers",
    icon: "📺",
    accentColor: "#06b6d4",
    stickers: "/assets/stickers/cartoons.png",
    models: [
      { id: "gumball", name: "Gumball Watterson", url: "/assets/costumes/gumball/Gumball.vrm" },
      { id: "darwin", name: "Darwin Watterson", url: "/assets/costumes/gumball/Darwin.vrm" },
      { id: "jake", name: "Jake the Dog", url: "/assets/costumes/adventure_time/Jake.vrm" },
      { id: "bmo", name: "BMO", url: "/assets/costumes/adventure_time/BMO.vrm", scale: 0.5 }
    ]
  },
  {
    id: "cartoons_2",
    name: "Cartoon Pals II",
    tagline: "More friends from Elmore & the Candy Kingdom",
    icon: "🍬",
    accentColor: "#06b6d4",
    stickers: "/assets/stickers/cartoons_2.png",
    models: [
      { id: "teri", name: "Teri", url: "/assets/costumes/gumball/Teri.vrm" },
      { id: "tina_rex", name: "Tina Rex", url: "/assets/costumes/gumball/TinaRex.vrm" },
      { id: "peppermint_butler", name: "Peppermint Butler", url: "/assets/costumes/adventure_time/PeppermintButler.vrm" },
      { id: "gumball", name: "Gumball Watterson", url: "/assets/costumes/gumball/Gumball.vrm" }
    ]
  }
];

export function getCategoryById(id: string): CategoryDefinition {
  const found = CATEGORIES.find((c) => c.id === id);
  return found || CATEGORIES[0];
}
