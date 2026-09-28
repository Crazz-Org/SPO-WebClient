/**
 * The onboarding curriculum's instructions, in the WebClient's own words.
 *
 * The server tells us WHICH assignment is live (`TutorialId` = `MetaTask.KindId`)
 * and WHERE in it the player stands (`TutorialStage`). What it does not give us
 * is anything renderable: the only body it ships is a URL to an IIS page
 * (`TTask.GetBaseURL`, `Tasks/Tasks.pas:620-634`) written for Internet Explorer
 * 5, full of `window.navigate`, `<iframe id=hiddenFrame>` and images that no
 * longer exist. So the text lives here. It began as one entry per
 * `<KindId>/<Stage>` page under
 * `~/SPO-ASP/Five/0/Visual/Voyager/NewTycoon/Tasks/`, prose only, and has since
 * been rewritten against the current HUD (#1071): every control it names is one
 * the player can actually find on screen.
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
 *
 * Marker convention: a client-owned control label is written `[[Label]]`,
 * spelled exactly as the screen shows it, and the panel renders it in bold.
 * "Client-owned" means the string lives in `src/client` or in
 * `src/shared/building-details/template-groups.ts`. Names the server supplies
 * stay plain words with no marker — the directory tiles (Capitol, Towns, You,
 * People, Rankings), build categories and facility names, research categories
 * and inventions, and the `CloneMenu0` options such as Ads — because no client
 * render can prove them. Every marker is proven by `tutorial-ui-refs.test.tsx`.
 *
 * One text serves both layouts, desktop (1024 px and up) and phone. Where the
 * path differs, the same sentence names both.
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
        'At the top of your screen is the status bar, with the most important information about you. From left to right: the world and its current date, how much money you have and the money per hour you are making, then your NTA (National Tycoon Association) ranking, your name, {tycoon}, the company you are logged in as, and the number of facilities you own against the maximum you can have.',
        'On a phone the top bar is shorter: the world and the date, your money and your money per hour, then your ranking and your name.',
        'A [[Debt]] tag appears in the same bar when some of your facilities are losing money; click it to see which ones. New mail shows as a number on the [[Mail]] button at the bottom of the screen (on a phone, on the [[Mail]] tab).',
        'On a desktop screen the status bar also carries two small indicators. A dot with a number means other players are looking at the same area of the map as you; hover it and their names appear. A [[Backup]] tag means the servers are saving the world, and some actions may be slower for a while. If the connection to the servers is lost, a message covers the whole game until it comes back.',
      ],
    },
    {
      heading: 'Tutorial Introduction: News and Hints',
      paragraphs: [
        'The Starpeace Online screen carries useful information in three places.',
        'When you select a building, a small card appears over it with its name, what it is doing and who owns it; when the building is yours, it also carries hints on how to improve it. Its [[INSPECT]] button opens the full inspector, where everything about the building can be seen and changed.',
        'When nothing is selected, a line near the bottom of the screen gives you hints about the town you are looking at.',
        'The band just under the status bar announces the latest news of {world}, for example a facility being built. When the news points at a place on the map, click it and you are taken there.',
      ],
    },
  ],

  YourProfile: [
    {
      heading: 'Tutorial Introduction: Getting Around',
      paragraphs: [
        'It is now time to direct your attention to the buttons at the bottom of the screen: [[Build]], [[Map]], [[Empire]], [[Government]], [[Mail]], [[Chat]] and [[More]]. You reach every part of Starpeace Online through them. On a phone they are tabs along the bottom of the screen, and everything else is under [[More]].',
        '[[Mail]] opens your mail — a mail account was created under your alias when you joined {world}. [[Chat]] opens the chat, and [[Map]] a map of the whole world. Each one opens as a panel over the game; its [[Close]] button takes you back to the world.',
        'The rest will become clear as you continue with this tutorial. For now, open your profile: the [[Empire]] button (key E), or a click on your name in the status bar. On a phone, tap [[More]], then [[Profile]].',
      ],
    },
    {
      heading: 'Tutorial Introduction: Your Profile',
      paragraphs: [
        'Your profile opens in a panel (on a phone, in a sheet that slides up from the bottom). Under your alias, {tycoon}, you will find its sections; open [[Curriculum]].',
        'The [[Curriculum]] section holds everything about your account: your [[Fortune]], your [[Avg. Profit]], your total [[Prestige]] and your [[Nobility]]. Below those, [[Current Level]] describes your level and [[Next Level]] the one after it, with the requirements you need to reach it.',
        'Further down is your position in each of this world’s rankings. For now you are listed only in the NTA and Prestige rankings, but as soon as you start making money you will appear in more.',
        'At the bottom of the section is the [[Curriculum Items]] table — this is where your prestige is calculated.',
      ],
    },
    {
      heading: 'Tutorial Question: Prestige',
      paragraphs: [
        'Your prestige is a measure of how much you are respected by the people who live in {world}.',
        'Prestige is crucial if you ever want to start a political career, and there is always a prestige requirement to reach a new level.',
        'Every Curriculum item gives you a prestige value, positive or negative, and your total prestige is the sum of all of them.',
        'In the [[Curriculum Items]] table at the bottom of your profile’s [[Curriculum]] section there is an item that records when you joined {world}. Look at how many prestige points it gave you.',
      ],
    },
  ],

  TheSpider: [
    {
      heading: 'Tutorial Introduction: The Search Panel',
      paragraphs: [
        'The Search panel is your window on the whole world. Everything you need to know about {world} can be reached through it.',
        'To open it, click the search box at the bottom of the screen (or press Ctrl+K) and choose [[Open Search]]. On a phone, tap [[More]], then [[Search]].',
        'Capitol takes the map to the place where the Capitol was built. You may decide to run for office yourself one day.',
        'You lists links to your own facilities, which makes moving between your properties much quicker.',
        'People lets you browse the curricula of the other tycoons in this world, and their facilities. Rankings shows who is at the top of every business.',
      ],
    },
    {
      heading: 'Tutorial Question: The Search Panel',
      paragraphs: [
        'Open Towns to see every town in {world}, each with its number of inhabitants. The [[Show on map]] button on a town takes you to it on the map.',
        'Clicking the town itself shows more information about it, and links to all the companies and facilities within its borders.',
        'Look at the list of towns in {world}: which one has the most inhabitants at the moment?',
      ],
    },
    {
      heading: 'Tutorial Question: Prestige',
      paragraphs: [
        'Your prestige is a measure of how much you are respected by the people who live in {world}.',
        'Prestige will be crucial if you want to start a political career, and there is always a prestige requirement to reach a new level.',
        'Every Curriculum item gives you a prestige value, positive or negative, and your total prestige is the sum of all of them.',
        'In the [[Curriculum Items]] table at the bottom of your profile’s [[Curriculum]] section there is an item that records when you joined {world}. How many prestige points did you receive for joining?',
      ],
    },
  ],

  BuildFacility: [
    {
      heading: 'Tutorial Assignment: Build your first facilities',
      paragraphs: [
        'Stores are crucial in the Starpeace Online economy. They provide the inhabitants of each world with everything they need, and they are the fastest and simplest way for your company to become profitable.',
        'Choose a town — the one with the second highest population is usually your best bet — and build there. Open the build panel with the [[Build]] button (key B; on a phone, the [[Build]] tab), pick the category, then the facility, and place it on the map: a green outline means you can build there, a red one means you cannot.',
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
        'Select the facility on the map and press [[INSPECT]]. In the [[General]] section you will find [[Connect]]: press it and move back to the map. The cursor becomes a crosshair and the mode bar at the bottom says "Click a building to connect"; click the facility you want to buy from.',
        'Connect mode ends after that one click, and the result appears as a notification. To connect to another facility, press [[Connect]] again. To leave without connecting, press Esc or the mode bar’s [[Cancel]] button.',
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
        'Demolish the construction site you just placed and choose another location. Select the site, press [[INSPECT]], and in the [[General]] section press [[Demolish]], then confirm by typing CONFIRM. The tutorial will warn you again if the new location is not connected either, and will go back to the previous assignment once the site is gone.',
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
        'Open the build panel with the [[Build]] button (on a phone, the [[Build]] tab), choose Headquarters, pick the Company Headquarters and place it on the map. A green outline means you can build there; it cannot be further than three squares from a road.',
        'It is always a good idea to ask more experienced players, or the mayor, for a good spot — they know {town} far better than you do.',
      ],
    },
  ],

  BuyAds: [
    {
      heading: 'Tutorial Assignment: Request advertisement',
      paragraphs: [
        'Now that you have a Company Headquarters you can buy advertisement for your stores. Ads can be the deciding element against the competition.',
        'The headquarters was connected to the available advertisement suppliers automatically when it was built. Select any one of your stores, press [[INSPECT]] and open the [[Services]] section.',
        'Move the [[Demand]] slider all the way up to request the largest amount of advertisement available. The [[Supply]] bar fills as the ads arrive, and the line below it shows how much is supplied against how much is demanded.',
        'Watch the [[Desirability]] figure at the top of the store’s inspector to see the effect — it measures how much the population is drawn to your stores, and it climbs as the ads arrive.',
        'The ads are bought by the headquarters; the store only requests them, and their cost lands on the headquarters’ money per hour. Do not run round the map repeating this for every store — the next assignment shows a far quicker way.',
      ],
    },
  ],

  CloneAds: [
    {
      heading: 'Tutorial Assignment: Clone the ads setting',
      paragraphs: [
        'As your company grows, cloning becomes essential to managing it: one click copies the settings of one facility to every other facility of the same kind that you own.',
        'Select the store you requested ads for, press [[INSPECT]] and open the [[Upgrade]] section. Under [[Clone Settings]], clear [[Same Town]], check the Ads box, and press [[Apply Clone]].',
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
        'Open your profile (the [[Empire]] button; on a phone, [[More]] then [[Profile]]) and its [[Bank Account]] section, then press [[Request Loan]]. Type the amount you want in the empty field: the line below it shows the largest loan you can take, with the interest rate and the term, recalculated as you type. Press [[Borrow]], and the money is added to your total.',
      ],
    },
  ],

  Research: [
    {
      heading: 'Tutorial Assignment: Research your first technology',
      paragraphs: [
        'It is time to get into industry. Before you can build any industrial facility you must research the basic technology behind it.',
        'First you need the more general technology it depends on — Advanced Technologies — which prepares your company for the complexity of the industry business.',
        'Your headquarters is where research happens. Select it, press [[INSPECT]] and open the [[Research]] section. Open the General category, choose Advanced Technologies, and press [[Research]] on its row; while it runs it is listed under [[In research queue]] in the same section.',
        'When that completes, go back to the headquarters and research the industrial technology itself from the Industry category. A new assignment follows once it is done.',
      ],
    },
  ],

  HireSuppliers: [
    {
      heading: 'Tutorial Assignment: Hire suppliers for your warehouse',
      paragraphs: [
        'It is time to look for cheaper suppliers for your import warehouse.',
        'Select the warehouse, press [[INSPECT]] and open the [[Supplies]] section. Open the product you want and press [[Hire]]: a search window opens. Sort by [[Cost]] and press [[Search]]; the possible suppliers are listed below.',
        'Press [[Select All]], then [[Connect Selected]]. The suppliers appear in the [[Supplies]] section, and the warehouse will always buy from the cheapest one first.',
        'Some results may not appear in your list: a facility set to trade only within your company will not accept facilities from other companies. If the [[Supplies]] section stays empty, your stores will simply buy from the Trade Center instead.',
      ],
    },
  ],

  SellToAll: [
    {
      heading: 'Tutorial Assignment: Sell to all your stores',
      paragraphs: [
        'Now that you have an import warehouse it is time to use it, which means connecting it to your stores.',
        'Select it, press [[INSPECT]], and in the [[General]] section find the [[Quick Trade]] row: press [[Stores]] to connect every one of your stores at once.',
        'Your stores are then listed as buyers in the warehouse’s [[Products]] section. The next assignment guides you through picking the cheapest suppliers for them.',
      ],
    },
  ],

  ManuallyConnect: [
    {
      heading: 'Tutorial Assignment: Connect your store to your warehouse',
      paragraphs: [
        'To supply your stores with what you produce, connect them to your import warehouse.',
        'Select the warehouse, press [[INSPECT]] and, in the [[General]] section, press [[Connect]]. The cursor becomes a crosshair over the map.',
        'Click your store. A notification tells you which goods or raw materials the two facilities are now trading, and connect mode ends.',
      ],
    },
  ],

  OfferProducts: [
    {
      heading: 'Tutorial Assignment: Offer your products to other players',
      paragraphs: [
        'Now that your industry is filling your export warehouse, it is time to look for buyers.',
        'Select the export warehouse, press [[INSPECT]] and open the [[Products]] section. Open the product you want to sell and press [[Hire]]: a search window opens. Narrow it by [[Company]] or [[Town]] if you like, then press [[Search]]; the possible buyers are listed below the filters.',
        'Press [[Select All]] (or tick the ones you want), then [[Connect Selected]]. The buyers then appear in the [[Products]] section and the assignment is complete.',
        'Some results may not appear: a facility set to trade only within your company will not accept facilities from another one.',
      ],
    },
  ],

  GrowMoney: [
    {
      heading: 'Tutorial Assignment: Make money with commerce',
      paragraphs: [
        'In this assignment you have to make money. Your goal is to earn {goal} from stores alone.',
        'Now that you have the hang of building a profitable chain of stores, try different kinds. Open the build panel with the [[Build]] button (on a phone, the [[Build]] tab), look through the commerce categories, and experiment — as an Apprentice you get a full refund on anything you demolish.',
      ],
    },
  ],

  Farewell: [
    {
      heading: 'The Tutorial is over',
      paragraphs: [
        'We hope you were able to learn the basics needed to start building your empire in Starpeace Online.',
        'Close this panel when you are done with it. While an assignment is running you can always open it again with the [[Tutorial]] button at the top of your profile.',
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
