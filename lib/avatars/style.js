// Kohler Avatar Factory: the art direction. FLUX.1 Schnell is text-to-image only, so the
// reference board's look is written out here as a fixed style description, and every
// avatar is one unique subject + personality + accessory + background combination.

export const STYLE = {
  project: 'kohler',
  collection: 'starter_avatars',
  model: '@cf/black-forest-labs/flux-1-schnell',
  steps: 4,
  dimensions: '1024x1024',
  batch_size: 10,
};

const T = {
  human: 'realistic skin pores, freckles and finely detailed hair',
  fur: 'ultra detailed realistic fur with individual strands',
  feathers: 'ultra detailed realistic feathers with iridescent sheen',
  scales: 'detailed glossy realistic scales and textured skin',
  monster: 'detailed shaggy fur and wet glossy skin',
  alien: 'glossy iridescent translucent skin with subtle veins',
  robot: 'scratched chrome, chipped enamel paint and tiny glowing LEDs',
  fantasy: 'detailed scales, horns, fur and magical glowing details',
};

// [category, specific subject, short name for the avatar's title, texture]
// Every subject is used once in the starter set, so no two avatars are the same creature.
const S = (category, subject, short, texture) => ({ category, subject, short, texture });
export const SUBJECTS = [
  // humans: archetypes only. Prompts never name an ethnicity, so the exaggeration stays on
  // expressions and costumes and never drifts into caricaturing real groups of people.
  S('humans', 'a grandma DJ with giant curly grey hair', 'Granny', T.human),
  S('humans', 'a retired heavyweight boxer with a broken nose', 'Champ', T.human),
  S('humans', 'an opera tenor mid high-note', 'Tenor', T.human),
  S('humans', 'a tech billionaire in a black turtleneck', 'Founder', T.human),
  S('humans', 'a Viking chieftain with a braided beard', 'Viking', T.human),
  S('humans', 'a medieval court jester', 'Jester', T.human),
  S('humans', 'a disco king with a huge afro wig and glitter', 'Disco', T.human),
  S('humans', 'a bodybuilder with absurdly huge neck muscles', 'Flex', T.human),
  S('humans', 'a mysterious fortune teller with a crystal ball', 'Oracle', T.human),
  S('humans', 'a mad scientist with smoking wild white hair', 'Doc', T.human),
  S('humans', 'an astronaut with a cracked helmet visor pushed up', 'Cosmo', T.human),
  S('humans', 'a pirate captain with an eyepatch', 'Captain', T.human),
  S('humans', 'a cowboy with a gigantic moustache', 'Tex', T.human),
  S('humans', 'a furious celebrity chef', 'Chef', T.human),
  S('humans', 'a stage magician with a top hat', 'Houdini', T.human),
  S('humans', 'a rockstar grandpa with a mullet', 'Gramps', T.human),
  // cats
  S('cats', 'a chubby ginger tabby cat', 'Ginger', T.fur),
  S('cats', 'a wrinkly sphynx cat', 'Sphynx', T.human),
  S('cats', 'a fluffy white Persian cat', 'Persia', T.fur),
  S('cats', 'a giant Maine Coon cat', 'Coon', T.fur),
  S('cats', 'a sleek black cat with yellow eyes', 'Midnight', T.fur),
  S('cats', 'a Scottish Fold cat with folded ears', 'Fold', T.fur),
  S('cats', 'a spotted Bengal cat', 'Bengal', T.fur),
  S('cats', 'an extremely chonky grey cat', 'Chonk', T.fur),
  // dogs
  S('dogs', 'a pug', 'Pug', T.fur),
  S('dogs', 'a corgi', 'Corgi', T.fur),
  S('dogs', 'a husky with heterochromia eyes', 'Husky', T.fur),
  S('dogs', 'a French bulldog', 'Frenchie', T.fur),
  S('dogs', 'a fancy groomed poodle', 'Poodle', T.fur),
  S('dogs', 'a basset hound with enormous droopy ears', 'Basset', T.fur),
  S('dogs', 'a tiny chihuahua', 'Chi', T.fur),
  S('dogs', 'a golden retriever', 'Goldie', T.fur),
  S('dogs', 'a shiba inu', 'Shiba', T.fur),
  S('dogs', 'a dachshund', 'Weenie', T.fur),
  // birds
  S('birds', 'a toucan with a giant colourful beak', 'Toucan', T.feathers),
  S('birds', 'a great horned owl', 'Hoot', T.feathers),
  S('birds', 'a pink flamingo', 'Flamingo', T.feathers),
  S('birds', 'a scarlet macaw parrot', 'Polly', T.feathers),
  S('birds', 'an emperor penguin', 'Waddles', T.feathers),
  S('birds', 'a city pigeon', 'Pidge', T.feathers),
  S('birds', 'a peacock with fanned tail feathers', 'Peacock', T.feathers),
  S('birds', 'a bald eagle', 'Eagle', T.feathers),
  S('birds', 'a rooster with a huge red comb', 'Rooster', T.feathers),
  S('birds', 'a sulphur-crested cockatoo', 'Cocky', T.feathers),
  // apes and other primates
  S('apes', 'a silverback gorilla', 'Silverback', T.fur),
  S('apes', 'an orangutan with wild orange hair', 'Rangi', T.fur),
  S('apes', 'a chimpanzee', 'Chimp', T.fur),
  S('apes', 'a mandrill with a colourful face', 'Mandrill', T.fur),
  S('apes', 'a ring-tailed lemur with huge eyes', 'Lemur', T.fur),
  S('apes', 'a proboscis monkey with a giant nose', 'Nosey', T.fur),
  // reptiles and amphibians
  S('reptiles', 'a chameleon with swivelling eyes', 'Chameleon', T.scales),
  S('reptiles', 'a green iguana', 'Iggy', T.scales),
  S('reptiles', 'a crocodile', 'Croc', T.scales),
  S('reptiles', 'an ancient tortoise', 'Shelly', T.scales),
  S('reptiles', 'a leopard gecko', 'Gecko', T.scales),
  S('reptiles', 'a bullfrog', 'Ribbit', T.scales),
  S('reptiles', 'a pink axolotl', 'Axo', T.alien),
  S('reptiles', 'a Komodo dragon', 'Komodo', T.scales),
  // rodents and small mammals
  S('rodents', 'a hamster with stuffed cheeks', 'Hammy', T.fur),
  S('rodents', 'a capybara', 'Capy', T.fur),
  S('rodents', 'a sewer rat', 'Ratso', T.fur),
  S('rodents', 'a red squirrel', 'Nutty', T.fur),
  S('rodents', 'a guinea pig', 'Squeaks', T.fur),
  S('rodents', 'a chinchilla', 'Chilla', T.fur),
  S('rodents', 'a beaver with huge front teeth', 'Beav', T.fur),
  S('rodents', 'a tiny field mouse', 'Mousey', T.fur),
  // wild animals
  S('wild', 'a raccoon', 'Bandit', T.fur),
  S('wild', 'a three-toed sloth', 'Sloth', T.fur),
  S('wild', 'a giant panda', 'Panda', T.fur),
  S('wild', 'a koala', 'Koala', T.fur),
  S('wild', 'a hippopotamus', 'Hippo', T.human),
  S('wild', 'a mountain goat', 'Billy', T.fur),
  S('wild', 'a llama', 'Llama', T.fur),
  S('wild', 'a grizzly bear', 'Grizz', T.fur),
  S('wild', 'a lion with a huge mane', 'Leo', T.fur),
  S('wild', 'a red fox', 'Foxy', T.fur),
  S('wild', 'a grey wolf', 'Lobo', T.fur),
  S('wild', 'a sea otter', 'Otto', T.fur),
  S('wild', 'a walrus with giant tusks', 'Tusk', T.human),
  S('wild', 'a camel', 'Humphrey', T.fur),
  S('wild', 'a long-eared rabbit', 'Bun', T.fur),
  S('wild', 'a tiger', 'Stripes', T.fur),
  // monsters
  S('monsters', 'a furry purple monster', 'Grape', T.monster),
  S('monsters', 'a gooey green slime monster', 'Slimer', T.alien),
  S('monsters', 'a one-eyed cyclops', 'Cyclops', T.human),
  S('monsters', 'a yeti', 'Yeti', T.monster),
  S('monsters', 'a swamp creature covered in moss', 'Swampy', T.monster),
  S('monsters', 'a mischievous gremlin', 'Gremlin', T.monster),
  S('monsters', 'a baby kraken', 'Kraken', T.alien),
  S('monsters', 'a stone gargoyle', 'Gargoyle', 'cracked stone texture with moss'),
  // aliens
  S('aliens', 'a little green alien with antennae', 'Zorp', T.alien),
  S('aliens', 'a tall grey alien with huge black eyes', 'Grey', T.alien),
  S('aliens', 'a tentacled squid-faced alien', 'Squiddo', T.alien),
  S('aliens', 'a crystal alien made of glowing gems', 'Crystal', 'faceted glowing crystal surfaces'),
  S('aliens', 'a jelly alien with a see-through head', 'Jello', T.alien),
  S('aliens', 'a three-eyed blue alien', 'Trio', T.alien),
  // robots
  S('robots', 'a retro tin toy robot', 'Tinbot', T.robot),
  S('robots', 'a sleek chrome android', 'Chrome', T.robot),
  S('robots', 'a rusty junkyard robot', 'Rusty', T.robot),
  S('robots', 'a robot with a toaster for a head', 'Toasty', T.robot),
  S('robots', 'a giant mech with a tiny cockpit face', 'Mecha', T.robot),
  S('robots', 'a vacuum cleaner robot with googly eyes', 'Vroom', T.robot),
  // fantasy
  S('fantasy', 'a baby dragon', 'Drako', T.fantasy),
  S('fantasy', 'a unicorn with a rainbow mane', 'Uni', T.fantasy),
  S('fantasy', 'a goblin with huge pointy ears', 'Gobbo', T.human),
  S('fantasy', 'a bridge troll', 'Troll', T.monster),
  S('fantasy', 'an ancient wizard with a long beard', 'Merlin', T.human),
  S('fantasy', 'a phoenix made of flames', 'Phoenix', T.feathers),
  S('fantasy', 'a minotaur', 'Bull', T.fur),
  S('fantasy', 'a griffin', 'Griff', T.feathers),
  S('fantasy', 'a tiny fairy with dragonfly wings', 'Pixie', T.human),
  S('fantasy', 'a vampire count', 'Count', T.human),
  // hybrids
  S('hybrids', 'a shark-cat hybrid', 'Sharkitty', T.fur),
  S('hybrids', 'an owlbear', 'Owlbear', T.feathers),
  S('hybrids', 'a frog prince', 'Prince', T.scales),
  S('hybrids', 'a bunny-dragon hybrid', 'Drabbit', T.fantasy),
  S('hybrids', 'a penguin-octopus hybrid', 'Pengtopus', T.alien),
  S('hybrids', 'a cat with butterfly wings', 'Flutter', T.fur),
  S('hybrids', 'a pug-hamster hybrid', 'Hampug', T.fur),
  S('hybrids', 'a lion-goat chimera', 'Chimera', T.fur),
];

export const PERSONALITIES = {
  ridiculously_rich: { phrase: 'ridiculously rich and smug, eyebrow raised, smirking', names: ['Baron', 'Lady', 'Sir', 'Mogul', 'Duke', 'Big Money'] },
  furiously_angry: { phrase: 'furiously angry, veins popping, teeth clenched, steam from ears', names: ['Furious', 'Raging', 'Grumpy', 'Livid'] },
  overconfident: { phrase: 'wildly overconfident, huge cocky grin, finger guns', names: ['The Great', 'Champion', 'Undefeated', 'King'] },
  dramatically_crying: { phrase: 'dramatically crying with huge tears, wobbling lip', names: ['Weeping', 'Sobbing', 'Teary', 'Heartbroken'] },
  suspicious: { phrase: 'deeply suspicious, side-eye, one eye squinted', names: ['Shady', 'Sneaky', 'Sus', 'Agent'] },
  adorably_confused: { phrase: 'adorably confused, head tilted, question in the eyes', names: ['Lost', 'Puzzled', 'Dizzy', 'Clueless'] },
  intimidating: { phrase: 'menacing and intimidating, glaring straight at the camera', names: ['Iron', 'Grim', 'Big Boss', 'Don'] },
  unserious: { phrase: 'completely unserious, tongue out, goofy laughing face', names: ['Silly', 'Goofy', 'Lil', 'Wacky'] },
  sleepy: { phrase: 'extremely sleepy, half-closed eyes, mid-yawn', names: ['Snoozy', 'Drowsy', 'Sleepy', 'Napping'] },
  eccentric: { phrase: 'wildly eccentric, manic wide eyes, bizarre grin', names: ['Professor', 'Captain', 'Mad', 'Doctor'] },
};

export const ACCESSORIES = {
  gold_chains: 'stacked chunky gold chains',
  diamond_crowns: 'a sparkling diamond crown',
  oversized_sunglasses: 'giant oversized designer sunglasses',
  gaming_headsets: 'a glowing RGB gaming headset',
  designer_hats: 'an outrageous designer bucket hat',
  ridiculous_hairstyles: 'a ridiculous towering hairstyle',
  hoodies: 'an oversized streetwear hoodie',
  royal_clothing: 'a velvet royal robe with an ermine collar',
  earrings: 'huge diamond stud earrings',
  grills: 'a shiny gold tooth grill',
};
// grills and chains read as a meme on a pug or a lizard; on human characters they lean on
// stereotypes, so humans never get them
const HUMAN_SAFE = ['diamond_crowns', 'oversized_sunglasses', 'gaming_headsets', 'designer_hats', 'ridiculous_hairstyles', 'hoodies', 'royal_clothing', 'earrings'];

export const BACKGROUNDS = {
  luxury_mansion: 'a luxury mansion interior with chandeliers',
  neon_gaming_room: 'a neon-lit gaming room with RGB lights',
  volcanic_sky: 'an erupting volcano under a red sky',
  cyberpunk_city: 'a rainy cyberpunk city at night with neon signs',
  fantasy_castle: 'a fairytale castle at sunset',
  tropical_beach: 'a tropical beach with palm trees',
  golden_palace: 'a golden palace hall full of treasure',
  colourful_studio: 'a colourful gradient photo studio backdrop',
};

export const CATEGORIES = ['humans', 'cats', 'dogs', 'birds', 'apes', 'reptiles', 'rodents', 'wild', 'monsters', 'aliens', 'robots', 'fantasy', 'hybrids'];
export const CATEGORY_LABEL = { humans: 'Human', cats: 'Cat', dogs: 'Dog', birds: 'Bird', apes: 'Ape', reptiles: 'Reptile', rodents: 'Rodent', wild: 'Wild animal', monsters: 'Monster', aliens: 'Alien', robots: 'Robot', fantasy: 'Fantasy', hybrids: 'Hybrid' };

export const TIERS = {
  free: { price: 0, weight: 40 },
  common: { price: 99, weight: 30 },
  rare: { price: 299, weight: 18 },
  epic: { price: 699, weight: 9 },
  legendary: { price: 1999, weight: 3 },
};
const ORDER = ['free', 'common', 'rare', 'epic', 'legendary'];

const pick = (arr, r) => arr[Math.floor(r() * arr.length)];
// small seeded PRNG so a plan is reproducible from its seed
export function rng(seed) { let a = seed >>> 0 || 1; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function buildPrompt(sp) {
  const s = sp.subjectText || sp.subject;
  const p = PERSONALITIES[sp.personality]?.phrase || sp.personality || 'with a hilariously over-the-top expression';
  const a = ACCESSORIES[sp.accessory] || '';
  const b = BACKGROUNDS[sp.background] || BACKGROUNDS.colourful_studio;
  const extra = sp.extra ? ` Extra detail: ${sp.extra}.` : '';
  return [
    `Hyper-exaggerated pseudo-realistic 3D CGI meme character portrait of ${s}, ${p}${a ? `, wearing ${a}` : ''}.${extra}`,
    `${sp.texture || 'highly detailed realistic textures'}. Cartoonishly exaggerated huge expressive eyes, oversized mouth and teeth, squishy cheeks, absurd funny memorable personality, premium animated-feature-film meets photoreal look.`,
    'Premium cinematic CGI render, subsurface scattering, dramatic rim lighting, crisp focus on the face, shallow depth of field.',
    `Background: ${b}, vibrant colours, softly blurred.`,
    'Centred head-and-shoulders portrait, square composition, the face is large, fully visible and looking at the camera, single character, family-friendly, fully clothed, no text, no letters, no watermark, no logo, no border.',
  ].join(' ').slice(0, 2000);
}

// Plan `count` new starter avatars, never reusing a subject already in the library.
export function planCatalogue(count, usedSubjects = new Set(), usedNames = new Set(), seed = Date.now()) {
  const r = rng(seed), free = SUBJECTS.filter((s) => !usedSubjects.has(s.subject));
  // shuffle, then spread categories so a batch isn't ten dogs in a row
  for (let i = free.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [free[i], free[j]] = [free[j], free[i]]; }
  const byCat = {}; for (const s of free) (byCat[s.category] ||= []).push(s);
  const order = []; let more = true;
  while (more) { more = false; for (const c of CATEGORIES) { const x = byCat[c]?.shift(); if (x) { order.push(x); more = true; } } }
  const pers = Object.keys(PERSONALITIES), acc = Object.keys(ACCESSORIES), bgs = Object.keys(BACKGROUNDS);
  const weights = ORDER.flatMap((t) => Array(TIERS[t].weight).fill(t));
  return order.slice(0, count).map((s, i) => {
    const personality = pers[(i + Math.floor(r() * pers.length)) % pers.length];
    const accessory = s.category === 'humans' ? pick(HUMAN_SAFE, r) : pick(acc, r);
    const background = bgs[(i * 3 + Math.floor(r() * bgs.length)) % bgs.length];
    let tier = pick(weights, r);
    if (personality === 'ridiculously_rich' || accessory === 'diamond_crowns') tier = ORDER[Math.min(4, ORDER.indexOf(tier) + 1)];
    let name = `${pick(PERSONALITIES[personality].names, r)} ${s.short}`;
    for (let k = 2; usedNames.has(name.toLowerCase()); k++) name = `${pick(PERSONALITIES[personality].names, r)} ${s.short}${k > 3 ? ' ' + k : ''}`;
    usedNames.add(name.toLowerCase());
    return { ...s, personality, accessory, background, tier, price: TIERS[tier].price, name, seed: Math.floor(r() * 2 ** 31) };
  });
}

/* ── custom avatars: players pick from lists, plus a short optional detail ── */
// Free text is short, letters-only and filtered: no real people, no other companies'
// characters, nothing sexual or hateful. Admin can still remove any custom avatar.
const BLOCK = /\b(nude|naked|nsfw|sex\w*|porn\w*|boob\w*|breast\w*|nipple\w*|genital\w*|penis|vagina|butt|thong|lingerie|bikini|underwear|topless|erotic\w*|fetish\w*|kink\w*|blood\w*|gore|gory|corpse|dead|kill\w*|murder\w*|gun\w*|rifle|knife|weapon\w*|bomb\w*|terror\w*|nazi\w*|swastika|kkk|hitler|isis|slave\w*|drug\w*|cocaine|weed|meth|heroin|syringe|cigarette\w*|vape|alcohol|beer|vodka|suicide|self.?harm|child\w*|kid|kids|teen\w*|minor\w*|baby face|schoolgirl|loli\w*|trump|biden|obama|putin|musk|elon|swift|kardashian|beyonce|rihanna|drake|kanye|messi|ronaldo|lebron|jordan|disney|mickey|minnie|pixar|marvel|spider.?man|batman|superman|pikachu|pokemon|mario|luigi|sonic|shrek|simpson\w*|spongebob|hello kitty|barbie|nintendo|star wars|yoda|harry potter|naruto|goku|minion\w*|logo|brand)\b/i;
// A player's own description ("a grumpy pigeon in a tiny tuxedo"). Kohler's house style, the
// portrait framing and the family-friendly rules are always wrapped around it.
export const PROMPT_MIN = 6, PROMPT_MAX = 200;
export function promptSpec(input) {
  const text = String(input.prompt || '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length < PROMPT_MIN) return { error: 'Describe your avatar in a few words.' };
  if (text.length > PROMPT_MAX) return { error: `Keep it under ${PROMPT_MAX} characters.` };
  if (!/^[\p{L}\p{N} ,.'!?&()\-]+$/u.test(text)) return { error: 'Use letters, numbers and simple punctuation only.' };
  if (BLOCK.test(text)) return { error: 'That isn’t allowed. Describe a made-up character: no real people, brands, other franchises, or anything violent or adult.' };
  const personality = PERSONALITIES[input.personality] ? input.personality : null;
  const background = BACKGROUNDS[input.background] ? input.background : 'colourful_studio';
  const short = text.split(' ').slice(0, 3).join(' ').replace(/^(a|an|the) /i, '').slice(0, 24);
  return { spec: { category: 'custom', subject: 'custom', subjectText: text, short: short.charAt(0).toUpperCase() + short.slice(1), personality, accessory: null, background, extra: null, userPrompt: text } };
}
export function customSpec(input) {
  if (input && input.prompt !== undefined) return promptSpec(input);
  const c = String(input.category || ''), subject = SUBJECTS.find((s) => s.subject === input.subject && s.category === c);
  if (!subject) return { error: 'Pick a character type.' };
  if (!PERSONALITIES[input.personality]) return { error: 'Pick a personality.' };
  if (!ACCESSORIES[input.accessory]) return { error: 'Pick an accessory.' };
  if (subject.category === 'humans' && !HUMAN_SAFE.includes(input.accessory)) return { error: 'That accessory is not available for human characters.' };
  if (!BACKGROUNDS[input.background]) return { error: 'Pick a background.' };
  const extra = String(input.extra || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (extra && !/^[\p{L}\p{N} ,'-]+$/u.test(extra)) return { error: 'Extra detail can only use letters, numbers and spaces.' };
  if (extra && BLOCK.test(extra)) return { error: 'That detail isn’t allowed. Keep it to colours, outfits and props.' };
  return { spec: { ...subject, personality: input.personality, accessory: input.accessory, background: input.background, extra: extra || null } };
}
export const CUSTOM_OPTIONS = () => ({
  categories: CATEGORIES.map((c) => ({ id: c, label: CATEGORY_LABEL[c], subjects: SUBJECTS.filter((s) => s.category === c).map((s) => ({ id: s.subject, label: s.subject.replace(/^(a|an) /, '') })) })),
  personalities: Object.entries(PERSONALITIES).map(([id, p]) => ({ id, label: id.replace(/_/g, ' ') })),
  accessories: Object.keys(ACCESSORIES).map((id) => ({ id, label: id.replace(/_/g, ' '), human: HUMAN_SAFE.includes(id) })),
  backgrounds: Object.keys(BACKGROUNDS).map((id) => ({ id, label: id.replace(/_/g, ' ') })),
});
