/**
 * The onboarding curriculum's instructions, in the WebClient's own words.
 *
 * The server tells us WHICH assignment is live (`TutorialId` = `MetaTask.KindId`)
 * and WHERE in it the player stands (`TutorialStage`). What it does not give us
 * is anything renderable: the only body it ships is a URL to an IIS page
 * (`TTask.GetBaseURL`, `Tasks/Tasks.pas:620-634`) written for Internet Explorer
 * 5, full of `window.navigate`, `<iframe id=hiddenFrame>` and images that no
 * longer exist. So the text lives here, transcribed one entry per
 * `<KindId>/<Stage>` page under
 * `~/SPO-ASP/Five/0/Visual/Voyager/NewTycoon/Tasks/`, prose only — the markup,
 * the scripts and the hidden command frame are exactly what this replaces.
 *
 * Three pages are deliberately empty of prose in the original and so carry none
 * here: `BuildFacility/1` is a pure `Response.Redirect` to `Roads/0`
 * (`BuildFacility/1/default.asp:3-4`), `Tutorial/0` is a title image over an
 * empty `<div>` (`Tutorial/0/default.asp:58-62`), and `Farewell/1` is a single
 * banner. They are present as entries so an unknown kind stays distinguishable
 * from a kind whose page said nothing.
 *
 * `{tycoon}`, `{world}`, `{company}`, `{town}` and `{goal}` are the five
 * placeholders the panel substitutes; `<%= TycoonName %>` and
 * `<%= WorldName %>` in the pages became the first two. Every other ASP
 * expression the pages interpolated (facility names, counts, loan amounts) came
 * from the page's own server-side query, which we do not make — those sentences
 * are rewritten to stand without them.
 */

export interface TutorialStageContent {
  /** The heading the page carries, e.g. 'Tutorial Assignment: Ask for a Loan'. */
  heading: string;
  /**
   * The page's prose, one string per paragraph. `{tycoon}`, `{world}`,
   * `{company}`, `{town}` and `{goal}` are substituted by the panel.
   */
  paragraphs: string[];
}

/** Keyed by TutorialId (MetaTask.KindId); index = TutorialStage. */
export const TUTORIAL_CONTENT: Readonly<Record<string, readonly TutorialStageContent[]>> = {
  Welcome: [
    {
      heading: 'Welcome to the Tutorial',
      paragraphs: [
        'Hello {tycoon}, welcome to {world}! It seems you are new to this world.',
        'If by chance you are also new to Starpeace Online we strongly recommend you take this tutorial. It will guide you through a brief explanation of the game’s interface and help you get started.',
        'If you follow it to the end, we guarantee that your company will be making money in very short time.',
      ],
    },
  ],

  WhoYouAre: [
    {
      heading: 'Tutorial Introduction: Who you are',
      paragraphs: [
        'Whenever the Portals to a new planet are discovered, a limited number of humans is selected to act as the driving force in its colonization. Every world has a certain number of Portals which people can immigrate through.',
        'Congratulations, you, {tycoon}, are one of them!',
        'The IFEL (International Federation for Extraterrestrial Life) has granted you 100 million and the goal of establishing a society in {world}. Of course, it is perfectly all right for you to become immensely rich and powerful in the process.',
      ],
    },
    {
      heading: 'Tutorial Introduction: Vital Info',
      paragraphs: [
        'At the bottom of your screen you can see some important information. Before your name, {tycoon}, is your NTA (National Tycoon Association) ranking. After that is the number of facilities you own against the maximum you can have.',
        'Below that is the name of the company you are logged in as, how much money you have, the money per hour you are making, and the current date of the world.',
        'At the far right of the same panel there are some small indicators. A lit eye means someone else is looking at the same spot on the map as you; hover it and their name appears. A lit disk means the servers are taking a backup, the envelope blinks when you have new mail, and a red mark on the pipe means you are disconnected from the servers.',
      ],
    },
    {
      heading: 'Tutorial Introduction: The Tickers',
      paragraphs: [
        'There are three tickers in the Starpeace Online interface, and they all carry useful information.',
        'The green ticker gives you a general overview of the selected building, or, when nothing is selected, hints about the town you are in.',
        'The orange ticker tells you how to improve a selected building you own — and who owns it, when you do not.',
        'The teal ticker at the bottom left announces when a player starts building a facility; click it while the notice shows and you are taken to the construction site. When nothing is being built, it carries hints and news.',
      ],
    },
  ],

  YourProfile: [
    {
      heading: 'Tutorial Introduction: The Toolbar',
      paragraphs: [
        'It is now time to direct your attention to the toolbar. You reach every part of Starpeace Online through it.',
        'One icon opens your mail client — a mail account was created under your alias when you joined {world}. Another opens the chat. At any time you can go back to the world map from the same bar.',
        'The rest of the icons will become clear as you continue with this tutorial. For now, open your Profile page.',
      ],
    },
    {
      heading: 'Tutorial Introduction: Your Profile',
      paragraphs: [
        'Your Profile panel opens beside the map. Under your alias, {tycoon}, and your NTA ranking you will find its sections; open Curriculum.',
        'The Curriculum page holds everything about your account: your personal fortune, average profit, total prestige and nobility. Below those is a description of your current level, and beside it the next level with the requirements you need to reach it.',
        'Further down is your position in each of this world’s rankings. For now you are listed only in the NTA and Prestige rankings, but as soon as you start making money you will appear in more.',
        'At the bottom of the page are your Curriculum items — this is where your prestige is calculated.',
      ],
    },
    {
      heading: 'Tutorial Question: Prestige',
      paragraphs: [
        'Your prestige is a measure of how much you are respected by the people who live in {world}.',
        'Prestige is crucial if you ever want to start a political career, and there is always a prestige requirement to reach a new level.',
        'Every Curriculum item gives you a prestige value, positive or negative, and your total prestige is the sum of all of them.',
        'At the bottom of your Profile page there is a Curriculum item that records when you joined {world}. Look at how many prestige points it gave you.',
      ],
    },
  ],

  TheSpider: [
    {
      heading: 'Tutorial Introduction: The Spider',
      paragraphs: [
        'The Search panel is your window on the whole world. Everything you need to know about {world} can be reached through it.',
        'Capitol takes the map to the place where the Capitol was built, and shows you who the President is. You may decide to run for office yourself one day.',
        'Your own entry lists links to your facilities, which makes moving between your properties much quicker.',
        'People lets you browse the curricula of the other tycoons in this world, and their facilities. Rankings shows who is at the top of every business.',
      ],
    },
    {
      heading: 'Tutorial Question: The Spider',
      paragraphs: [
        'Open Towns to see every town in {world}. Each one shows its number of inhabitants, and asking to show one on the map takes you to its Town Hall.',
        'Opening a town shows more information about it, and links to all the companies and facilities within its borders.',
        'Look at the list of towns in {world}: which one has the most inhabitants at the moment?',
      ],
    },
    {
      heading: 'Tutorial Question: Prestige',
      paragraphs: [
        'Your prestige is a measure of how much you are respected by the people who live in {world}.',
        'Prestige will be crucial if you want to start a political career, and there is always a prestige requirement to reach a new level.',
        'Every Curriculum item gives you a prestige value, positive or negative, and your total prestige is the sum of all of them.',
        'At the bottom of your Profile page there is a Curriculum item that records when you joined {world}. How many prestige points did you receive for joining?',
      ],
    },
  ],

  BuildFacility: [
    {
      heading: 'Tutorial Assignment: Build your first facilities',
      paragraphs: [
        'Stores are crucial in the Starpeace Online economy. They provide the inhabitants of each world with everything they need, and they are the fastest and simplest way for your company to become profitable.',
        'Choose a town — the one with the second highest population is usually your best bet — and build there. Open the Build panel from the toolbar, pick the category, then the facility, and place it on the map: a green outline means you can build there, a red one means you cannot.',
        'A facility cannot be built more than three squares from a road. Keep your stores close to residential buildings, and do not be afraid to demolish one that is not profitable — at Apprentice level you get back what you spent.',
        'When you build an industrial facility, place it in an industrial part of the town: it keeps pollution away from residential and commercial areas, and keeps transportation costs down.',
      ],
    },
    // Stage 1 is a redirect page in the original (`BuildFacility/1/default.asp:3-4`)
    // and carries no prose of its own.
    {
      heading: 'Tutorial Assignment: Build your first facilities',
      paragraphs: [],
    },
    {
      heading: 'Tutorial Assignment: Wait for the facility to open',
      paragraphs: [
        'You are doing well. Wait until the facility you just built is fully operational — you will receive a new assignment by then.',
      ],
    },
    {
      heading: 'Tutorial Assignment: Select suppliers',
      paragraphs: [
        'Facilities need supplies in order to produce. Finding and hiring suppliers is simple, but a successful investor needs to know how to choose them — this assignment teaches you the mechanics.',
        'Select the facility on the map, then open its settings. Among the tools there you will find Connect: choose it and move the cursor back to the map. The cursor takes the shape of an aim over a facility; click to connect to it.',
        'You can keep requesting goods from as many facilities as you like; the aim stays until you press Escape.',
      ],
    },
    {
      heading: 'Tutorial Assignment: Connect by roads',
      paragraphs: [
        'Those facilities need to be connected by roads so they can trade goods and raw materials.',
      ],
    },
  ],

  Roads: [
    {
      heading: 'Tutorial Warning: Construction site not connected',
      paragraphs: [
        'The road your facility is built by is not connected to the Trade Center or to a Construction Plant.',
        'As an Apprentice you cannot build roads — that is reserved for mayors and more advanced players.',
        'Demolish the construction site you just placed and choose another location. Select the site, open its inspector and use Demolish. The tutorial will warn you again if the new location is not connected either, and will go back to the previous assignment once the site is gone.',
      ],
    },
  ],

  // Server KindId is 'MainHq' (Tasks/CommonTasks.pas:77); the ASP folder is spelled MainHQ — IIS ignored case, an object key does not.
  MainHq: [
    {
      heading: 'Tutorial Assignment: Build the Company Headquarters',
      paragraphs: [
        'As your company grows, so does the paperwork. You do not really need a headquarters until you own 50 buildings; between 50 and 100 the lack of one starts hurting your facilities, and past 100 none of them will work without it.',
        'Even before then, a headquarters is very useful: it is where you buy advertisement and research the technologies that improve your outlets. The next assignments will show you both.',
        'Open the Build panel, choose Headquarters, pick the Company Headquarters and place it on the map. A green outline means you can build there; it cannot be further than three squares from a road.',
        'It is always a good idea to ask more experienced players, or the mayor, for a good spot — they know {town} far better than you do.',
      ],
    },
  ],

  BuyAds: [
    {
      heading: 'Tutorial Assignment: Request advertisement',
      paragraphs: [
        'Now that you have a Company Headquarters you can buy advertisement for your stores. Ads can be the deciding element against the competition.',
        'The headquarters was connected to the available advertisement suppliers automatically when it was built. Select any one of your stores, open its inspector and go to the Services tab.',
        'Use the slider to buy the largest amount of advertisement available. The hits requested rise to the maximum, the hits received follow, and the ratio settles at 100%.',
        'Watch Desirability in the green ticker to see the effect — it measures how much the population is drawn to your stores, and it climbs as the ads arrive.',
        'The ads are bought by the headquarters; the store only requests them, and their cost lands on the headquarters’ money per hour. Do not run round the map repeating this for every store — the next assignment shows a far quicker way.',
      ],
    },
  ],

  CloneAds: [
    {
      heading: 'Tutorial Assignment: Clone the ads setting',
      paragraphs: [
        'As your company grows, cloning becomes essential to managing it: one click copies the settings of one facility to every other facility of the same kind that you own.',
        'Go to the Management tab of the store you requested ads for. Clear the "same town" box, check the Ads box in the clone settings, and clone.',
        'Every store of that type will now request the maximum amount of advertisement from your headquarters.',
      ],
    },
  ],

  AskLoan: [
    {
      heading: 'Tutorial Assignment: Ask for a loan',
      paragraphs: [
        'A very good way to expand {company} further is to take a loan from the IFEL bank. You are about to build your first industry, and industries can be expensive, so some extra cash will help.',
        'Whatever your level, a loan is a quick way to get money instead of waiting for yours to grow.',
        'Open your Profile page and go to Bank Account. The largest amount you can borrow is already filled in; as you change it you will see the term and the interest recalculated. Borrow, and the money is added to your total.',
      ],
    },
  ],

  Research: [
    {
      heading: 'Tutorial Assignment: Research your first technology',
      paragraphs: [
        'It is time to get into industry. Before you can build any industrial facility you must research the basic technology behind it.',
        'First you need the more general technology it depends on — Advanced Technologies — which prepares your company for the complexity of the industry business.',
        'Your headquarters is where research happens. Select it, open its inspector and go to Research. Open the General branch, choose Advanced Technologies, and start the research; its progress shows above the headquarters on the map.',
        'When that completes, go back to the headquarters and research the industrial technology itself from the Industry branch. A new assignment follows once it is done.',
      ],
    },
  ],

  HireSuppliers: [
    {
      heading: 'Tutorial Assignment: Hire suppliers for your warehouse',
      paragraphs: [
        'It is time to look for cheaper suppliers for your import warehouse.',
        'Select the warehouse, open its inspector and go to the Supplies tab, then use Hire to open the search and run it. The possible suppliers come back listed by price.',
        'Select them all and buy from the selection. The suppliers appear in the inspector below, and the warehouse will always buy from the cheapest one first.',
        'Some results may not appear in your list: a facility set to trade only within your company will not accept facilities from other companies. If the Supplies tab stays empty, your stores will simply buy from the Trade Center instead.',
      ],
    },
  ],

  SellToAll: [
    {
      heading: 'Tutorial Assignment: Sell to all your stores',
      paragraphs: [
        'Now that you have an import warehouse it is time to use it, which means connecting it to your stores.',
        'Select it, open its inspector, and choose the option to connect to every store at once.',
        'The Clients tab of the warehouse will then list all of your stores. The next assignment guides you through picking the cheapest suppliers for them.',
      ],
    },
  ],

  ManuallyConnect: [
    {
      heading: 'Tutorial Assignment: Connect your store to your warehouse',
      paragraphs: [
        'To supply your stores with what you produce, connect them to your import warehouse.',
        'Select the warehouse and open its inspector, then choose to pick the target on the map. The cursor turns into a bullseye over a building and a forbidden sign over open ground.',
        'Click your store, and a panel tells you which goods or raw materials the two facilities are now trading.',
      ],
    },
  ],

  OfferProducts: [
    {
      heading: 'Tutorial Assignment: Offer your products to other players',
      paragraphs: [
        'Now that your industry is filling your export warehouse, it is time to look for buyers.',
        'Select the export warehouse, open its inspector and go to the Clients page, then open the panel to sell products. Enter a count and search; the possible buyers come back on the right.',
        'Pick the ones you want, or select them all, and sell to the selection. The buyers then appear in the inspector below and the assignment is complete.',
        'Some results may not appear: a facility set to trade only within your company will not accept facilities from another one.',
      ],
    },
  ],

  GrowMoney: [
    {
      heading: 'Tutorial Assignment: Make money with commerce',
      paragraphs: [
        'In this assignment you have to make money. Your goal is to earn {goal} from stores alone.',
        'Now that you have the hang of building a profitable chain of stores, try different kinds. Open the Build panel, look through the commerce section, and experiment — as an Apprentice you get a full refund on anything you demolish.',
      ],
    },
  ],

  Farewell: [
    {
      heading: 'The Tutorial is over',
      paragraphs: [
        'We hope you were able to learn the basics needed to start building your empire in Starpeace Online.',
        'Close this panel when you are done with it. You can always open it again from your Profile page.',
        'Good luck!',
      ],
    },
    {
      heading: 'Start tutorial assignments',
      paragraphs: [],
    },
  ],

  Tutorial: [
    {
      heading: 'Welcome to the Tutorial',
      paragraphs: [],
    },
  ],
};

/**
 * The instructions for one assignment stage, or `null`.
 *
 * `null` for an unknown kind or a stage past the end. The panel then shows the
 * server's own title, goal and progress and no instructions — never a URL, and
 * never a crash: the curriculum a given world runs is the server's to change,
 * and a kind we have no page for is a gap in this table, not an error.
 */
export function tutorialContentFor(kindId: string, stage: number): TutorialStageContent | null {
  const stages = TUTORIAL_CONTENT[kindId];
  if (!stages) return null;
  if (!Number.isInteger(stage) || stage < 0 || stage >= stages.length) return null;
  return stages[stage];
}
