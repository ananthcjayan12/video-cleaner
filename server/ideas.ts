/**
 * "What to say this week": short reel ideas per field (niche), each with a hook and three talking points for the
 * teleprompter. Kept health-safe: no promises, no "painless/best/guaranteed", general statements only.
 * Three ideas rotate in every week; the full list is in the Ideas tab.
 */
export type Niche = 'dental' | 'physio' | 'nutrition' | 'optometry';
export const NICHES: Array<{ id: Niche; label: string }> = [
  { id: 'dental', label: 'Dental' }, { id: 'physio', label: 'Physiotherapy' }, { id: 'nutrition', label: 'Nutrition' }, { id: 'optometry', label: 'Optometry' },
];
export const nicheValue = (value: unknown): Niche => NICHES.some((n) => n.id === value) ? value as Niche : 'dental';

export type IdeaKind = 'Myth' | 'Patient question' | 'Quick tip' | 'Habit';
export type Idea = { id: string; kind: IdeaKind; title: string; hook: string; points: string[]; seconds: number };

const idea = (id: string, kind: IdeaKind, title: string, hook: string, points: string[], seconds = 45): Idea => ({ id, kind, title, hook, points, seconds });

export const IDEAS: Record<Niche, Idea[]> = {
  dental: [
    idea('d-bleeding-gums', 'Myth', 'Bleeding gums are normal when you brush hard?', 'Bleeding when you brush is not normal.', ['What bleeding gums usually mean', 'Why brushing harder can make it worse', 'When to get your gums checked']),
    idea('d-scaling', 'Patient question', 'Is scaling bad for your teeth?', '"Will cleaning make my teeth loose?" I hear this every week.', ['What scaling actually removes', 'Why teeth can feel different for a few days', 'How often most people need it'], 40),
    idea('d-root-canal', 'Myth', 'Root canal: what really happens', 'A root canal is not what most people imagine.', ['Why a tooth needs a root canal', 'What happens in the chair, step by step', 'How it feels afterwards for most patients']),
    idea('d-kids-first-visit', 'Quick tip', "Your child's first dental visit", 'When should a child first see a dentist? Earlier than you think.', ['The age we usually suggest', 'What happens at the first visit', 'How to keep it calm for your child'], 40),
    idea('d-sensitivity', 'Patient question', 'Why do my teeth hurt with cold drinks?', 'That sharp feeling with ice cream has a reason.', ['What tooth sensitivity is', 'Common everyday causes', 'Simple things that often help, and when to see us']),
    idea('d-brushing-time', 'Habit', 'Are you brushing long enough?', 'Most people brush for less than one minute.', ['How long to brush', 'The spots most people miss', 'Soft brush or hard brush?'], 35),
    idea('d-wisdom-teeth', 'Patient question', 'Do wisdom teeth always need to come out?', 'Not every wisdom tooth needs to be removed.', ['When they can stay', 'Signs one may be causing trouble', 'Why an X-ray helps decide']),
    idea('d-mouthwash', 'Myth', 'Mouthwash can replace brushing?', 'Mouthwash is not a shortcut.', ['What mouthwash can and cannot do', 'Why brushing and flossing still matter', 'When a dentist may suggest one'], 35),
  ],
  physio: [
    idea('p-neck-phone', 'Habit', 'Neck pain from your phone', 'Your neck carries more weight when you look down at your phone.', ['Why looking down strains the neck', 'One simple change in how you hold the phone', 'When neck pain needs a check-up']),
    idea('p-back-crack', 'Patient question', 'Is cracking your back safe?', '"I crack my back every day. Is that okay?"', ['What the cracking sound is', 'When it is usually harmless', 'Signs it is time to see a physio'], 40),
    idea('p-heat-ice', 'Quick tip', 'Heat or ice after a sprain?', 'Heat or ice? Many people pick the wrong one.', ['What to use in the first two days', 'When heat can help', 'When to get the sprain assessed'], 40),
    idea('p-desk-stretch', 'Habit', 'Three desk stretches for office workers', 'Sitting all day? Try this between meetings.', ['A gentle neck stretch', 'A shoulder and upper back stretch', 'Why moving every 30 minutes matters']),
    idea('p-knee-stairs', 'Patient question', 'Knee pain when climbing stairs', 'Knee pain on the stairs is common, and often helped by exercise.', ['Common reasons for knee pain on stairs', 'Why strong thigh muscles matter', 'When to get it checked']),
    idea('p-rest-myth', 'Myth', 'Bed rest is best for back pain?', 'Lying in bed for days is usually not the answer for back pain.', ['What the research generally suggests', 'Gentle movement that often helps', 'Warning signs that need a doctor']),
    idea('p-posture', 'Myth', 'There is one perfect posture?', 'There is no single perfect posture.', ['Why changing position matters more', 'Small habits through the day', 'When posture-related pain needs help'], 40),
    idea('p-walking', 'Quick tip', 'Walking after surgery or injury', 'Walking is often part of recovery, done the right way.', ['Why gentle walking can help', 'How to start slowly', 'Signs to stop and call your physio'], 40),
  ],
  nutrition: [
    idea('n-rice-weight', 'Myth', 'Is rice making you gain weight?', 'You do not have to stop eating rice.', ['Portion size matters more than one food', 'What to add to your rice plate', 'An easy everyday swap']),
    idea('n-kerala-breakfast', 'Quick tip', 'A balanced Kerala breakfast', 'Puttu and kadala can be a balanced breakfast.', ['Why protein at breakfast helps', 'Easy additions: egg, sprouts, curd', 'How to keep the oil in check']),
    idea('n-detox-water', 'Myth', 'Does detox water work?', 'Your liver and kidneys already do the detox.', ['What detox drinks actually do', 'What really supports your body', 'Simple hydration tips'], 40),
    idea('n-veg-protein', 'Patient question', 'Enough protein as a vegetarian?', '"I am vegetarian. Am I getting enough protein?"', ['Good vegetarian protein sources', 'How to add protein to each meal', 'When to ask a dietitian']),
    idea('n-fruit-night', 'Myth', 'Fruit after dinner is bad?', 'Fruit at night is a common worry.', ['What matters more than the time', 'Portion and type of fruit', 'An easy evening snack idea'], 35),
    idea('n-sugar-tea', 'Habit', 'The sugar in your tea adds up', 'Three cups of tea a day can add a lot of sugar.', ['How much sugar a cup usually has', 'How to cut down slowly', 'Swaps that keep the taste']),
    idea('n-label', 'Quick tip', 'How to read a food label in 10 seconds', 'Three things to check on any food label.', ['Serving size', 'Sugar and salt', 'The first three ingredients'], 40),
    idea('n-water', 'Patient question', 'How much water do I need?', '"Eight glasses a day" is only a rough guide.', ['What changes how much you need', 'Signs you may need more', 'Easy ways to drink enough'], 35),
  ],
  optometry: [
    idea('o-screen-kids', 'Habit', 'Screen time and kids\' eyes', 'Kids are spending more time on screens than ever.', ['How long screens are usually fine', 'The 20-20-20 rule', 'Signs a child should get an eye test']),
    idea('o-yearly-test', 'Patient question', 'Do I need an eye test every year?', '"My eyes feel fine. Why test them?"', ['Why some problems have no early signs', 'How often adults and children usually need a test', 'What happens during an eye test'], 40),
    idea('o-blue-light', 'Myth', 'Are blue-light glasses worth it?', 'Blue-light glasses are everywhere. Do you need them?', ['What the evidence generally says', 'What actually helps tired eyes', 'When to see an optometrist']),
    idea('o-dry-eyes-ac', 'Quick tip', 'Why do eyes get dry in AC rooms?', 'Air conditioning can dry your eyes.', ['Why it happens', 'Simple habits that often help', 'When dryness needs a check-up'], 40),
    idea('o-child-board', 'Patient question', 'Can your child see the board?', 'Some children do not know they cannot see clearly.', ['Signs parents can notice', 'Why school eye checks matter', 'What a child eye test is like']),
    idea('o-reading-dark', 'Myth', 'Reading in dim light ruins your eyes?', 'Reading in dim light is a very common worry.', ['What it actually does', 'Good lighting habits', 'When eye strain needs attention'], 35),
    idea('o-sunglasses', 'Quick tip', 'Sunglasses are not just for style', 'Your eyes need sun protection too.', ['Why UV protection matters', 'What to look for when buying', 'Kids need them too'], 35),
    idea('o-contacts', 'Habit', 'Contact lens habits to stop today', 'Three contact lens habits optometrists see every week.', ['Sleeping in lenses', 'Using water to clean them', 'Wearing them longer than advised']),
  ],
};

/** The same three ideas for the whole week (changes every Monday), different per account. */
export function weeklyIdeas(niche: Niche, seed: string, now = new Date()) {
  const list = IDEAS[niche];
  const monday = new Date(now); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const week = Math.floor(monday.getTime() / (7 * 86400_000));
  let hash = 0; for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const start = (week * 3 + hash) % list.length;
  return [0, 1, 2].map((offset) => list[(start + offset) % list.length]);
}
