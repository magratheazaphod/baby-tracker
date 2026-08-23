// CDC "Learn the Signs. Act Early." milestone checklists (2022 revision).
// Each item is something most children (>=75%) do by that age. Generic
// public-health reference data - no personal content belongs in this file.
//
// Categories: social (social/emotional), language (language/communication),
// cognitive (learning, thinking, problem solving), movement (movement/
// physical development).
//
// Wording follows the CDC checklists, lightly trimmed and made
// gender-neutral. Source: cdc.gov/ncbddd/actearly/milestones
//
// The CDC lists deliberately re-ask the same skill at a higher bar in a later
// bracket, which reads as duplication in a flat list. Two optional fields make
// that progression explicit instead:
//   supersedes: id of the earlier item this one raises the bar on. The UI shows
//     that item's bracket and status underneath, so a repeat reads as "same
//     skill, higher bar" rather than "didn't I already check this?".
//   note: one short line naming the delta, where the CDC wording alone doesn't.
// Checking an item never implies the one it supersedes - each is logged on the
// day it's observed.
const MILESTONE_CHECKLIST = [
  // ---- 2 months ----
  { id: '2mo-calms-when-spoken-to', bracket: 2, category: 'social', text: 'Calms down when spoken to or picked up' },
  { id: '2mo-looks-at-your-face', bracket: 2, category: 'social', text: 'Looks at your face' },
  { id: '2mo-happy-to-see-you', bracket: 2, category: 'social', text: 'Seems happy to see you when you walk up to them' },
  { id: '2mo-smiles', bracket: 2, category: 'social', text: 'Smiles when you talk to or smile at them' },
  { id: '2mo-sounds-other-than-crying', bracket: 2, category: 'language', text: 'Makes sounds other than crying' },
  { id: '2mo-reacts-to-loud-sounds', bracket: 2, category: 'language', text: 'Reacts to loud sounds' },
  { id: '2mo-watches-you-move', bracket: 2, category: 'cognitive', text: 'Watches you as you move' },
  { id: '2mo-looks-at-toy', bracket: 2, category: 'cognitive', text: 'Looks at a toy for several seconds' },
  { id: '2mo-holds-head-up', bracket: 2, category: 'movement', text: 'Holds head up when on tummy' },
  { id: '2mo-moves-arms-and-legs', bracket: 2, category: 'movement', text: 'Moves both arms and both legs' },
  { id: '2mo-opens-hands', bracket: 2, category: 'movement', text: 'Opens hands briefly' },

  // ---- 4 months ----
  { id: '4mo-smiles-to-get-attention', bracket: 4, category: 'social', text: 'Smiles on their own to get your attention' },
  { id: '4mo-chuckles', bracket: 4, category: 'social', text: 'Chuckles (not yet a full laugh) when you try to make them laugh' },
  { id: '4mo-keeps-your-attention', bracket: 4, category: 'social', text: 'Looks at you, moves, or makes sounds to get or keep your attention' },
  { id: '4mo-coos', bracket: 4, category: 'language', text: 'Makes cooing sounds like "oooo" and "aahh"' },
  { id: '4mo-sounds-back', bracket: 4, category: 'language', text: 'Makes sounds back when you talk to them' },
  { id: '4mo-turns-to-your-voice', bracket: 4, category: 'language', text: 'Turns head toward the sound of your voice' },
  { id: '4mo-opens-mouth-when-hungry', bracket: 4, category: 'cognitive', text: 'If hungry, opens mouth when they see the breast or bottle' },
  { id: '4mo-looks-at-hands', bracket: 4, category: 'cognitive', text: 'Looks at their hands with interest' },
  { id: '4mo-holds-head-steady', bracket: 4, category: 'movement', text: 'Holds head steady without support when you are holding them' },
  { id: '4mo-holds-a-toy', bracket: 4, category: 'movement', text: 'Holds a toy when you put it in their hand' },
  { id: '4mo-swings-at-toys', bracket: 4, category: 'movement', text: 'Uses their arm to swing at toys' },
  { id: '4mo-hands-to-mouth', bracket: 4, category: 'movement', text: 'Brings hands to mouth' },
  { id: '4mo-pushes-up-on-elbows', bracket: 4, category: 'movement', text: 'Pushes up onto elbows or forearms when on tummy' },

  // ---- 6 months ----
  { id: '6mo-knows-familiar-people', bracket: 6, category: 'social', text: 'Knows familiar people' },
  { id: '6mo-looks-in-mirror', bracket: 6, category: 'social', text: 'Likes to look at themself in a mirror' },
  { id: '6mo-laughs', bracket: 6, category: 'social', text: 'Laughs', supersedes: '4mo-chuckles' },
  { id: '6mo-takes-turns-with-sounds', bracket: 6, category: 'language', text: 'Takes turns making sounds with you' },
  { id: '6mo-blows-raspberries', bracket: 6, category: 'language', text: 'Blows "raspberries" (sticks tongue out and blows)' },
  { id: '6mo-squeals', bracket: 6, category: 'language', text: 'Makes squealing noises' },
  { id: '6mo-mouths-things', bracket: 6, category: 'cognitive', text: 'Puts things in their mouth to explore them' },
  { id: '6mo-reaches-for-toy', bracket: 6, category: 'cognitive', text: 'Reaches to grab a toy they want' },
  { id: '6mo-closes-lips', bracket: 6, category: 'cognitive', text: 'Closes lips to show they do not want more food' },
  { id: '6mo-rolls-tummy-to-back', bracket: 6, category: 'movement', text: 'Rolls from tummy to back' },
  { id: '6mo-pushes-up-straight-arms', bracket: 6, category: 'movement', text: 'Pushes up with straight arms when on tummy' },
  { id: '6mo-leans-on-hands-sitting', bracket: 6, category: 'movement', text: 'Leans on hands to support themself when sitting' },

  // ---- 9 months ----
  { id: '9mo-shy-with-strangers', bracket: 9, category: 'social', text: 'Is shy, clingy, or fearful around strangers' },
  { id: '9mo-facial-expressions', bracket: 9, category: 'social', text: 'Shows several facial expressions, like happy, sad, angry, and surprised' },
  { id: '9mo-looks-when-named', bracket: 9, category: 'social', text: 'Looks when you call their name' },
  { id: '9mo-reacts-when-you-leave', bracket: 9, category: 'social', text: 'Reacts when you leave (looks, reaches for you, or cries)' },
  { id: '9mo-peekaboo', bracket: 9, category: 'social', text: 'Smiles or laughs when you play peek-a-boo' },
  { id: '9mo-babbles', bracket: 9, category: 'language', text: 'Makes different sounds like "mamamama" and "bababababa"' },
  { id: '9mo-lifts-arms-to-be-picked-up', bracket: 9, category: 'language', text: 'Lifts arms up to be picked up' },
  { id: '9mo-looks-for-dropped-objects', bracket: 9, category: 'cognitive', text: 'Looks for objects when dropped out of sight, like a spoon or toy' },
  { id: '9mo-bangs-things-together', bracket: 9, category: 'cognitive', text: 'Bangs two things together' },
  { id: '9mo-gets-to-sitting', bracket: 9, category: 'movement', text: 'Gets to a sitting position by themself' },
  { id: '9mo-transfers-hand-to-hand', bracket: 9, category: 'movement', text: 'Moves things from one hand to the other hand' },
  { id: '9mo-rakes-food', bracket: 9, category: 'movement', text: 'Uses fingers to "rake" food toward themself' },
  { id: '9mo-sits-without-support', bracket: 9, category: 'movement', text: 'Sits without support' },

  // ---- 12 months ----
  { id: '12mo-plays-games', bracket: 12, category: 'social', text: 'Plays games with you, like pat-a-cake' },
  { id: '12mo-waves-bye-bye', bracket: 12, category: 'language', text: 'Waves "bye-bye"' },
  { id: '12mo-calls-parent-name', bracket: 12, category: 'language', text: 'Calls a parent "mama" or "dada" or another special name' },
  { id: '12mo-understands-no', bracket: 12, category: 'language', text: 'Understands "no" (pauses briefly or stops when you say it)' },
  { id: '12mo-puts-things-in-container', bracket: 12, category: 'cognitive', text: 'Puts something in a container, like a block in a cup' },
  { id: '12mo-looks-for-hidden-things', bracket: 12, category: 'cognitive', text: 'Looks for things they see you hide, like a toy under a blanket' },
  { id: '12mo-pulls-up-to-stand', bracket: 12, category: 'movement', text: 'Pulls up to stand' },
  { id: '12mo-cruises', bracket: 12, category: 'movement', text: 'Walks while holding on to furniture' },
  { id: '12mo-drinks-from-open-cup', bracket: 12, category: 'movement', text: 'Drinks from a cup without a lid, as you hold it' },
  { id: '12mo-pincer-grasp', bracket: 12, category: 'movement', text: 'Picks things up between thumb and pointer finger, like small bits of food' },

  // ---- 15 months ----
  { id: '15mo-copies-other-children', bracket: 15, category: 'social', text: 'Copies other children while playing, like taking toys out of a container when another child does' },
  { id: '15mo-shows-you-an-object', bracket: 15, category: 'social', text: 'Shows you an object they like' },
  { id: '15mo-claps-when-excited', bracket: 15, category: 'social', text: 'Claps when excited' },
  { id: '15mo-hugs-a-toy', bracket: 15, category: 'social', text: 'Hugs a stuffed doll or other toy' },
  { id: '15mo-shows-affection', bracket: 15, category: 'social', text: 'Shows you affection with hugs, cuddles, or kisses' },
  { id: '15mo-tries-one-or-two-words', bracket: 15, category: 'language', text: 'Tries to say one or two words besides "mama" or "dada", like "ba" for ball' },
  { id: '15mo-looks-at-named-object', bracket: 15, category: 'language', text: 'Looks at a familiar object when you name it' },
  { id: '15mo-follows-gesture-directions', bracket: 15, category: 'language', text: 'Follows directions given with both a gesture and words' },
  { id: '15mo-points-to-ask', bracket: 15, category: 'language', text: 'Points to ask for something or to get help' },
  { id: '15mo-uses-things-correctly', bracket: 15, category: 'cognitive', text: 'Tries to use things the right way, like a phone, cup, or book' },
  { id: '15mo-stacks-two-objects', bracket: 15, category: 'cognitive', text: 'Stacks at least two small objects, like blocks' },
  { id: '15mo-takes-a-few-steps', bracket: 15, category: 'movement', text: 'Takes a few steps on their own' },
  { id: '15mo-finger-feeds', bracket: 15, category: 'movement', text: 'Uses fingers to feed themself some food' },

  // ---- 18 months ----
  { id: '18mo-moves-away-but-checks', bracket: 18, category: 'social', text: 'Moves away from you, but looks to make sure you are close by' },
  { id: '18mo-points-to-show-you', bracket: 18, category: 'social', text: 'Points to show you something interesting', supersedes: '15mo-points-to-ask', note: 'Pointing to share, not to ask for something' },
  { id: '18mo-hands-out-to-be-washed', bracket: 18, category: 'social', text: 'Puts hands out for you to wash them' },
  { id: '18mo-looks-at-book-pages', bracket: 18, category: 'social', text: 'Looks at a few pages in a book with you' },
  { id: '18mo-helps-you-dress-them', bracket: 18, category: 'social', text: 'Helps you dress them by pushing an arm through a sleeve or lifting up a foot' },
  { id: '18mo-tries-three-or-more-words', bracket: 18, category: 'language', text: 'Tries to say three or more words besides "mama" or "dada"', supersedes: '15mo-tries-one-or-two-words' },
  { id: '18mo-follows-one-step-directions', bracket: 18, category: 'language', text: 'Follows one-step directions without any gestures, like "Give it to me"' },
  { id: '18mo-copies-chores', bracket: 18, category: 'cognitive', text: 'Copies you doing chores, like sweeping with a broom' },
  { id: '18mo-plays-with-toys-simply', bracket: 18, category: 'cognitive', text: 'Plays with toys in a simple way, like pushing a toy car' },
  { id: '18mo-walks-alone', bracket: 18, category: 'movement', text: 'Walks without holding on to anyone or anything', supersedes: '15mo-takes-a-few-steps', note: 'Walking is how they get around now, not just a few steps' },
  { id: '18mo-scribbles', bracket: 18, category: 'movement', text: 'Scribbles' },
  { id: '18mo-drinks-from-cup', bracket: 18, category: 'movement', text: 'Drinks from a cup without a lid while holding it themself, and may spill sometimes', supersedes: '12mo-drinks-from-open-cup' },
  { id: '18mo-feeds-self-with-fingers', bracket: 18, category: 'movement', text: 'Feeds themself with fingers', supersedes: '15mo-finger-feeds', note: 'A whole meal this way, not just a few bites' },
  { id: '18mo-tries-to-use-a-spoon', bracket: 18, category: 'movement', text: 'Tries to use a spoon' },
  { id: '18mo-climbs-on-and-off-furniture', bracket: 18, category: 'movement', text: 'Climbs on and off a couch or chair without help' },

  // ---- 24 months ----
  { id: '24mo-notices-others-upset', bracket: 24, category: 'social', text: 'Notices when others are hurt or upset, like pausing or looking sad when someone is crying' },
  { id: '24mo-looks-at-your-face-to-react', bracket: 24, category: 'social', text: 'Looks at your face to see how to react in a new situation' },
  { id: '24mo-points-to-things-in-a-book', bracket: 24, category: 'language', text: 'Points to things in a book when you ask, like "Where is the bear?"' },
  { id: '24mo-two-words-together', bracket: 24, category: 'language', text: 'Says at least two words together, like "More milk"' },
  { id: '24mo-points-to-body-parts', bracket: 24, category: 'language', text: 'Points to at least two body parts when you ask' },
  { id: '24mo-uses-more-gestures', bracket: 24, category: 'language', text: 'Uses more gestures than just waving and pointing, like blowing a kiss or nodding yes' },
  { id: '24mo-holds-and-uses-both-hands', bracket: 24, category: 'cognitive', text: 'Holds something in one hand while using the other hand, like taking a lid off a container' },
  { id: '24mo-uses-switches-and-buttons', bracket: 24, category: 'cognitive', text: 'Tries to use switches, knobs, or buttons on a toy' },
  { id: '24mo-plays-with-more-than-one-toy', bracket: 24, category: 'cognitive', text: 'Plays with more than one toy at the same time, like putting toy food on a toy plate' },
  { id: '24mo-kicks-a-ball', bracket: 24, category: 'movement', text: 'Kicks a ball' },
  { id: '24mo-runs', bracket: 24, category: 'movement', text: 'Runs' },
  { id: '24mo-walks-up-stairs', bracket: 24, category: 'movement', text: 'Walks (not climbs) up a few stairs with or without help' },
  { id: '24mo-eats-with-a-spoon', bracket: 24, category: 'movement', text: 'Eats with a spoon', supersedes: '18mo-tries-to-use-a-spoon', note: 'Gets the food to their mouth, not just trying' }
]

const MILESTONE_BRACKETS = [2, 4, 6, 9, 12, 15, 18, 24]
