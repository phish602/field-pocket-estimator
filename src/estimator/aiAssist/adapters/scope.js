// @ts-nocheck
/* eslint-disable */

const NUMBER_WORDS = new Set([
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
]);

const ACTION_PATTERNS = [
  {
    canonical: "replace",
    family: "replace_changeout",
    regex: /\breplac(?:e|ed|ing|ement)\b|\bswap(?:ped|ping)?(?:\s+out)?\b|\bchange(?:d|ing)?\s+out\b|\brenew(?:ed|ing)?\b|\bexchange(?:d|ing)?\b|\bupgrad(?:e|ed|ing)\b|\bretrofit(?:ted|ting)?\b|\bremove(?:d|ing)?(?:\s+and)?\s+replace(?:d|ing)?\b|\btear(?:ing)?\s+out\s+and\s+replace(?:d|ing)?\b|\bremove\/replace\b/i,
    tokenSequences: [
      ["replace"],
      ["replaced"],
      ["replacing"],
      ["replacement"],
      ["swap"],
      ["swapped"],
      ["swapping"],
      ["swap", "out"],
      ["swapped", "out"],
      ["swapping", "out"],
      ["change", "out"],
      ["changed", "out"],
      ["changing", "out"],
      ["renew"],
      ["renewed"],
      ["renewing"],
      ["exchange"],
      ["exchanged"],
      ["exchanging"],
      ["upgrade"],
      ["upgraded"],
      ["upgrading"],
      ["retrofit"],
      ["retrofitted"],
      ["retrofitting"],
      ["remove", "and", "replace"],
      ["remove", "replace"],
      ["tear", "out", "and", "replace"],
      ["tearing", "out", "and", "replace"],
      ["remove/replace"],
    ],
  },
  {
    canonical: "install",
    family: "install_add_mount",
    regex: /\binstal(?:l|led|ling)\b|\breinstal(?:l|led|ling)\b|\bput(?:ting)?(?:\s+(?:up|in|back))?\b|\brun(?:ning)?\b|\badd(?:ed|ing)?\b|\bmount(?:ing)?\b|\bset(?:ting)?\b|\bhang(?:ing)?\b|\bplace(?:d|ing)?\b|\bassembl(?:e|ed|ing)\b|\bfit(?:ted|ting)?\b|\bsecure(?:d|ing)?\s+in\s+place\b|\bset\s+in\s+place\b|\battach(?:ing)?\b|\breattach(?:ed|ing)?\b|\bframe(?:d|ing)?\s+out\b|\bfurnish(?:ed|ing)?\s+and\s+install\b|\bprovide(?:d|ing)?\s+and\s+install\b/i,
    tokenSequences: [
      ["install"],
      ["installed"],
      ["installing"],
      ["reinstall"],
      ["reinstalled"],
      ["reinstalling"],
      ["put"],
      ["put", "up"],
      ["put", "in"],
      ["put", "back"],
      ["putting"],
      ["putting", "up"],
      ["putting", "in"],
      ["putting", "back"],
      ["run"],
      ["running"],
      ["add"],
      ["added"],
      ["adding"],
      ["mount"],
      ["mounting"],
      ["set"],
      ["setting"],
      ["hang"],
      ["hanging"],
      ["place"],
      ["placed"],
      ["placing"],
      ["assemble"],
      ["assembled"],
      ["assembling"],
      ["fit"],
      ["fitted"],
      ["fitting"],
      ["secure", "in", "place"],
      ["secured", "in", "place"],
      ["securing", "in", "place"],
      ["set", "in", "place"],
      ["attach"],
      ["attaching"],
      ["reattach"],
      ["reattached"],
      ["reattaching"],
      ["frame", "out"],
      ["framed", "out"],
      ["framing", "out"],
      ["furnish", "and", "install"],
      ["provide", "and", "install"],
    ],
  },
  {
    canonical: "tie-in",
    family: "install_add_mount",
    regex: /\btie(?:-| )?in(?:s)?\b/i,
    tokenSequences: [["tie-in"], ["tie", "in"], ["ties", "in"]],
  },
  {
    canonical: "remove",
    family: "remove_demo",
    regex: /\bremov(?:e|ed|ing)\b|\bdecommission(?:ed|ing)?\b|\bdetach(?:ed|ing)?\b|\bdismantl(?:e|ed|ing)\b|\bpull(?:ing)?\b|\bextract(?:ed|ing)?\b|\bclear(?:ed|ing)?\s+out\b|\bhaul(?:-|\s)?off\b|\btak(?:e|ing|en)\s+down\b/i,
    tokenSequences: [
      ["remove"],
      ["removed"],
      ["removing"],
      ["decommission"],
      ["decommissioned"],
      ["decommissioning"],
      ["detach"],
      ["detached"],
      ["detaching"],
      ["dismantle"],
      ["dismantled"],
      ["dismantling"],
      ["pull"],
      ["pulling"],
      ["extract"],
      ["extracted"],
      ["extracting"],
      ["clear", "out"],
      ["cleared", "out"],
      ["clearing", "out"],
      ["haul", "off"],
      ["haul-off"],
      ["take", "down"],
      ["taking", "down"],
      ["taken", "down"],
    ],
  },
  {
    canonical: "demo",
    family: "remove_demo",
    regex: /\bdemo\b|\bdemol(?:ish|ished|ishing)\b|\btear(?:ing)?\s+out\b|\brip(?:ped|ping)?\s+out\b|\bgut(?:ted|ting)?\b|\bstrip(?:ped|ping)?(?:\s+out)?\b/i,
    tokenSequences: [
      ["demo"],
      ["demolish"],
      ["demolished"],
      ["demolishing"],
      ["tear", "out"],
      ["tearing", "out"],
      ["rip", "out"],
      ["ripped", "out"],
      ["ripping", "out"],
      ["gut"],
      ["gutted"],
      ["gutting"],
      ["strip"],
      ["strip", "out"],
      ["stripped", "out"],
      ["stripping", "out"],
    ],
  },
  {
    canonical: "repair",
    family: "repair_patch",
    regex: /\brepair(?:s|ed|ing)?\b|\brestore(?:d|ing)?\b|\bcorrect(?:ed|ing)?\b|\bfix(?:ed|ing)?\b|\bmend(?:ed|ing)?\b|\brework(?:ed|ing)?\b|\brebuild(?:ing|s)?\b|\brefinish(?:ed|ing)?\b|\bredo\b|\bmake\s+good\b|\btighten(?:ed|ing)?\b|\bstraighten(?:ed|ing)?\b|\bstabiliz(?:e|ed|ing)\b|\bblend(?:ed|ing)?\b|\bclean\s+up\s+damage\b|\bclose(?:d|ing)?(?:\s+it)?\s+up\b|\bclose\s+in\b/i,
    tokenSequences: [
      ["repair"],
      ["repairs"],
      ["repaired"],
      ["repairing"],
      ["restore"],
      ["restored"],
      ["restoring"],
      ["correct"],
      ["corrected"],
      ["correcting"],
      ["fix"],
      ["fixed"],
      ["fixing"],
      ["mend"],
      ["mended"],
      ["mending"],
      ["rework"],
      ["reworked"],
      ["reworking"],
      ["rebuild"],
      ["rebuilding"],
      ["rebuilds"],
      ["refinish"],
      ["refinished"],
      ["refinishing"],
      ["redo"],
      ["make", "good"],
      ["tighten"],
      ["tightened"],
      ["tightening"],
      ["straighten"],
      ["straightened"],
      ["straightening"],
      ["stabilize"],
      ["stabilized"],
      ["stabilizing"],
      ["blend"],
      ["blended"],
      ["blending"],
      ["clean", "up", "damage"],
      ["close", "up"],
      ["close", "it", "up"],
      ["closed", "up"],
      ["closed", "it", "up"],
      ["closing", "up"],
      ["closing", "it", "up"],
      ["close", "in"],
    ],
  },
  {
    canonical: "patch",
    family: "repair_patch",
    regex: /\bpatch(?:es|ed|ing)?\b|\bskim(?:med|ming)?\b|\btouch(?:ed|ing)?\s+up\b/i,
    tokenSequences: [
      ["patch"],
      ["patches"],
      ["patched"],
      ["patching"],
      ["skim"],
      ["skimmed"],
      ["skimming"],
      ["touch", "up"],
      ["touched", "up"],
      ["touching", "up"],
    ],
  },
  { canonical: "reconnect", family: "service_connection", regex: /\breconnect(?:ed|ing)?\b/i, tokenSequences: [["reconnect"], ["reconnected"], ["reconnecting"]] },
  { canonical: "disconnect", family: "service_connection", regex: /\bdisconnect(?:ed|ing)?\b/i, tokenSequences: [["disconnect"], ["disconnected"], ["disconnecting"]] },
  { canonical: "reset", family: "service_connection", regex: /\breset(?:ting)?\b|\bresecure(?:d|ing)?\b/i, tokenSequences: [["reset"], ["resetting"], ["resecure"], ["resecured"], ["resecuring"]] },
  { canonical: "weld", family: "service_connection", regex: /\bweld(?:ed|ing)?\b|\borbital weld(?:ing)?\b/i, tokenSequences: [["weld"], ["welded"], ["welding"], ["orbital", "weld"], ["orbital", "welding"]] },
  { canonical: "prime", family: "finish_coating", regex: /\bprime(?:d|ing)?\b/i, tokenSequences: [["prime"], ["primed"], ["priming"]] },
  { canonical: "paint", family: "finish_coating", regex: /\b(?:re)?paint(?:ed|ing)?\b|\bcoat(?:ed|ing)?\b/i, tokenSequences: [["paint"], ["painted"], ["painting"], ["repaint"], ["repainted"], ["repainting"], ["coat"], ["coated"], ["coating"]] },
  { canonical: "caulk", family: "finish_coating", regex: /\bre-?caulk(?:ed|ing)?\b|\bcaulk(?:ed|ing)?\b/i, tokenSequences: [["caulk"], ["caulked"], ["caulking"], ["recaulk"], ["recaulked"], ["recaulking"], ["re-caulking"]] },
  { canonical: "seal", family: "finish_coating", regex: /\bseal(?:ed|ing)?\b/i, tokenSequences: [["seal"], ["sealed"], ["sealing"]] },
  {
    canonical: "finish",
    family: "finish_coating",
    regex: /\bfinished\b|\bfinishing\b|\bfinish\s+out\b|\bapply\s+finish\b|\bwaterproof(?:ed|ing)?\b|\bskin(?:ned|ning)?\b/i,
    tokenSequences: [["finished"], ["finishing"], ["finish", "out"], ["apply", "finish"], ["waterproof"], ["waterproofed"], ["waterproofing"], ["skin"], ["skinned"], ["skinning"]],
  },
  { canonical: "texture", family: "finish_coating", regex: /\btexture(?:d|ing)?\b|\btexture match\b/i, tokenSequences: [["texture"], ["textured"], ["texturing"], ["texture", "match"]] },
  { canonical: "prep", family: "finish_coating", regex: /\bprep(?:ped|ping)?\b/i, tokenSequences: [["prep"], ["prepped"], ["prepping"]] },
  { canonical: "furnish", family: "install_add_mount", regex: /\bfurnish(?:ed|ing)?\b|\bprovide(?:d|ing)?\b/i, tokenSequences: [["furnish"], ["furnished"], ["furnishing"], ["provide"], ["provided"], ["providing"]] },
  {
    canonical: "service",
    family: "service_connection",
    regex: /\bservice\b|\binspect(?:ed|ing)?\b|\btest(?:ed|ing)?\b|\btroubleshoot(?:ing)?\b|\bdiagnos(?:e|ed|ing)\b|\bcalibrat(?:e|ed|ing)\b|\bcommission(?:ed|ing)?\b|\bstartup\b|\bstart\s+up\b|\bverify\b/i,
    tokenSequences: [
      ["service"],
      ["inspect"],
      ["inspected"],
      ["inspecting"],
      ["test"],
      ["tested"],
      ["testing"],
      ["troubleshoot"],
      ["troubleshooting"],
      ["diagnose"],
      ["diagnosed"],
      ["diagnosing"],
      ["calibrate"],
      ["calibrated"],
      ["calibrating"],
      ["commission"],
      ["commissioned"],
      ["commissioning"],
      ["startup"],
      ["start", "up"],
      ["verify"],
    ],
  },
];

const ACTION_SEQUENCE_PATTERNS = ACTION_PATTERNS
  .flatMap((entry) => (
    (Array.isArray(entry.tokenSequences) ? entry.tokenSequences : []).map((tokens) => ({
      canonical: entry.canonical,
      family: entry.family,
      tokens,
    }))
  ))
  .sort((left, right) => right.tokens.length - left.tokens.length);

const ACTION_TOKEN_MAP = ACTION_SEQUENCE_PATTERNS.reduce((map, entry) => {
  if (entry.tokens.length === 1) map[entry.tokens[0]] = entry.canonical;
  return map;
}, {});

const ACTION_START_TOKENS = new Set(
  ACTION_SEQUENCE_PATTERNS.map((entry) => entry.tokens[0]).filter(Boolean)
);

const ACTION_FAMILY_BY_CANONICAL = ACTION_PATTERNS.reduce((map, entry) => {
  if (entry.canonical) map[entry.canonical] = entry.family;
  return map;
}, {});

const LOCATION_PREPOSITIONS = new Set(["in", "at", "near", "around", "within", "inside", "outside", "throughout", "on", "from", "by"]);
const CAPTURE_STOP_WORDS = new Set([
  "bullet",
  "bullets",
  "point",
  "points",
  "numbered",
  "list",
  "paragraph",
  "professional",
  "professionally",
  "concise",
  "short",
  "shorter",
  "shorten",
  "rewrite",
  "reword",
  "clean",
  "cleaner",
  "wording",
  "format",
  "notes",
  "note",
  "keep",
  "expand",
  "slightly",
  "please",
  "pls",
  "it",
  "make",
  "this",
  "that",
]);

const UNCERTAINTY_PATTERNS = [
  { label: "as needed", regex: /\bas needed\b/i },
  { label: "if needed", regex: /\bif needed\b/i },
  { label: "as required", regex: /\bas required\b/i },
  { label: "where required", regex: /\bwhere required\b/i },
  { label: "where needed", regex: /\bwhere needed\b/i },
  { label: "subject to existing conditions", regex: /\bsubject to existing conditions\b/i },
  { label: "existing conditions", regex: /\bexisting conditions?\b/i },
  { label: "hidden damage", regex: /\bhidden damage\b/i },
  { label: "unforeseen conditions", regex: /\bunforeseen conditions?\b/i },
  { label: "if damaged", regex: /\bif damaged\b/i },
];

const DISPOSAL_REGEX = /\bhaul(?:-|\s)?away\b|\bhaul(?:-|\s)?off\b|\bdispose\b|\bdisposal\b|\bremove and dispose\b|\bdumpster\b/i;
const PATCH_REPAIR_REGEX = /\bpatch(?:es|ed|ing)?\b|\brepair(?:s|ed|ing)?\b/i;

const REWRITE_INTENT_PATTERNS = {
  rewrite: /\bclean this up\b|\bclean it up\b|\brewrite\b|\breword\b/i,
  professionalize: /\bprofessional(?:ly|ize)?\b|\bcleaner professional wording\b/i,
};

const BREVITY_INTENT_PATTERNS = {
  concise: /\bkeep (?:it|this) short\b|\bkeep (?:it|this) concise\b|\bconcise\b|\bshorten\b|\bbrief\b|\bmake (?:it|this) shorter\b/i,
  expand_slightly: /\bexpand slightly\b|\belaborate a bit\b|\ba little more detail\b|\badd a bit more detail\b|\bslightly more detail\b/i,
};

const SAFE_WORDING_REQUEST_REGEX = /\bsafe wording\b|\bsafer wording\b|\buncertainty[-\s]?aware\b|\bcontractor[-\s]?safe\b|\bprotective wording\b|\bqualified wording\b/i;
const EXPAND_REQUEST_REGEX = /\bexpand\b|\bmake (?:it|this) fuller\b|\bmake (?:it|this) more detailed\b|\badd detail\b|\badd more detail\b|\bmake (?:it|this) fuller\b|\bmake (?:it|this) more complete\b/i;

const AREA_SIGNAL_PATTERNS = [
  { label: "office", regex: /\boffice\b/i },
  { label: "bathroom", regex: /\bbath(?:room)?\b|\brestroom\b/i },
  { label: "hotel", regex: /\bhotel\b/i },
  { label: "kitchen", regex: /\bkitchen\b/i },
  { label: "parking lot", regex: /\bparking lot\b/i },
  { label: "unit", regex: /\bunit\b/i },
  { label: "room", regex: /\brooms?\b/i },
  { label: "site area", regex: /\bsite area\b|\bjobsite\b|\bjob site\b/i },
  { label: "exterior area", regex: /\bexterior\b|\boutdoor\b/i },
  { label: "wall surfaces", regex: /\bwalls?\b/i },
  { label: "ceiling surfaces", regex: /\bceilings?\b/i },
  { label: "elevation", regex: /\belevations?\b/i },
  { label: "work area", regex: /\bwork area\b/i },
];

const PREP_SIGNAL_PATTERNS = [
  { label: "mask and protect adjacent finishes as needed", regex: /\bmask(?:ing)?\b|\bprotect(?:ion)?\b/i },
  { label: "surface preparation", regex: /\bsurface prep\b|\bprep\b/i },
  { label: "clean affected areas", regex: /\bclean(?:ing| up)?\b/i },
  { label: "sand smooth", regex: /\bsand(?:ing)?\b/i },
  { label: "scrape loose material", regex: /\bscrap(?:e|ing)\b/i },
  { label: "move light furniture", regex: /\bmove light furniture\b|\blight furniture\b/i },
];

const ACCESS_SIGNAL_PATTERNS = [
  { label: "occupied area", regex: /\boccupied\b/i },
  { label: "limited access", regex: /\blimited access\b|\baccess limitations?\b/i },
  { label: "plumbing access", regex: /\bplumbing access\b/i },
  { label: "attic access", regex: /\battic\b/i },
  { label: "crawlspace access", regex: /\bcrawlspace\b|\bcrawl space\b/i },
  { label: "staging requirements", regex: /\bstaging\b/i },
  { label: "clear access required", regex: /\bclear access\b/i },
];

const CUSTOMER_RESPONSIBILITY_PATTERNS = [
  { label: "owner-supplied items", regex: /\bowner[-\s]?supplied\b|\bcustomer[-\s]?supplied\b/i },
  { label: "clear access to work area", regex: /\bclear access\b/i },
  { label: "utilities on for testing", regex: /\butilities?\s+on\b|\bpower on\b|\bwater on\b/i },
  { label: "finish selections provided", regex: /\bselections?\b|\bcolor selections?\b/i },
];

const SITE_CONDITION_PATTERNS = [
  { label: "damaged existing conditions", regex: /\bdamaged\b/i },
  { label: "rotten material", regex: /\brot(?:ten)?\b/i },
  { label: "concealed conditions", regex: /\bconcealed\b/i },
  { label: "hidden conditions", regex: /\bhidden\b/i },
  { label: "unknown conditions", regex: /\bunknown\b/i },
  { label: "unsafe conditions", regex: /\bunsafe\b/i },
  { label: "existing-condition uncertainty", regex: /\bexisting conditions?\b/i },
  { label: "code-related issues", regex: /\bcode\b/i },
];

const COMPLETION_SIGNAL_PATTERNS = [
  { label: "test for proper operation", regex: /\btest(?:ing)?\b|\bverify\b.*\boperation\b/i },
  { label: "clean up work area", regex: /\bclean up\b|\bcleanup\b/i },
  { label: "remove debris", regex: /\bdebris\b|\bhaul(?:-|\s)?away\b|\bdispose\b/i },
  { label: "leave ready for finish", regex: /\bready for finish\b|\bready for paint\b/i },
  { label: "installed and functional", regex: /\binstalled and functional\b/i },
];

const PAINT_TARGET_PATTERNS = [
  { label: "house surfaces", regex: /\bhouse\b|\bhome\b/i },
  { label: "interior areas", regex: /\binterior\b/i },
  { label: "exterior wall surfaces", regex: /\bexterior walls?\b/i },
  { label: "wall surfaces", regex: /\bwalls?\b/i },
  { label: "ceiling surfaces", regex: /\bceilings?\b/i },
  { label: "bedroom surfaces", regex: /\bbedrooms?\b/i },
  { label: "bathroom surfaces", regex: /\bbath(?:room)?\b|\brestroom\b/i },
  { label: "kitchen surfaces", regex: /\bkitchen\b/i },
  { label: "office surfaces", regex: /\boffice\b/i },
  { label: "trim surfaces", regex: /\btrim\b/i },
  { label: "door surfaces", regex: /\bdoors?\b/i },
  { label: "baseboard surfaces", regex: /\bbaseboards?\b/i },
];

const SITE_LIGHTING_ASSET_REGEX = /\blight poles?\b|\bpole lights?\b|\blight standards?\b|\bsite lighting\b|\bparking lot lighting\b|\bparking lot lights?\b|\barea lights?\b/i;
const SITE_ASSET_REGEX = /\bmounted asset\b|\bexterior equipment\b|\bsite equipment\b|\bsite asset\b|\bpole-mounted\b/i;
const POLE_MOUNTED_SITE_ASSET_REGEX = /\blight poles?\b|\bpole lights?\b|\blight standards?\b|\bpole-mounted\b/i;
const SITE_ENVIRONMENT_REGEX = /\bhotel\b|\bparking lot\b|\boutdoor\b|\bcampus\b|\bproperty\b|\bsite area\b|\bjobsite\b|\bjob site\b|\bexterior\b/i;
const SITE_EQUIPMENT_OBJECT_REGEX = /\blight poles?\b|\bpole lights?\b|\blight standards?\b|\bsite lighting\b|\bparking lot lighting\b|\bparking lot lights?\b|\barea lights?\b|\bmounted asset\b|\bexterior equipment\b|\bsite equipment\b|\bsite asset\b|\bsign poles?\b|\bbollards?\b|\bpole-mounted\b/i;
const REPLACEABLE_ASSET_ACTION_REGEX = /\bremove existing\b|\breplace existing\b|\bremove and replace\b|\binstall new\b/i;
const PLUMBING_FIXTURE_ASSET_REGEX = /\btoilet(?:s)?\b|\bsinks?\b|\bfaucets?\b|\bdrinking fountains?\b|\bmop sinks?\b|\bplumbing fixtures?\b/i;
const PLUMBING_EQUIPMENT_ASSET_REGEX = /\bwater heaters?\b|\btankless water heaters?\b/i;
const MECHANICAL_EQUIPMENT_ASSET_REGEX = /\bexhaust fans?\b|\brestroom fans?\b|\bvent fans?\b|\bvents?\b|\brooftop fans?\b|\brooftop units?\b|\brtu\b|\bcondensers?\b|\bair handlers?\b|\bmini[\s-]?splits?\b/i;
const ELECTRICAL_EQUIPMENT_ASSET_REGEX = /\bdisconnect(?:s)?\b|\bbreakers?\b|\b(?:electrical|distribution|control|switchgear|breaker|existing|new)\s+panels?\b|\bpanelboards?\b|\blights?\b|\blight fixtures?\b|\blighting fixtures?\b|\bhigh[-\s]?bay(?:\s+light(?:ing)?)?\s+fixtures?\b|\bpole lights?\b|\blight poles?\b/i;
const GLAZING_STOREFRONT_ASSET_REGEX = /\bstorefront glass panels?\b|\bstorefront glazing panels?\b|\bglazing panels?\b|\bstorefront windows?\b|\bstorefront glass\b|\bstorefront frame\b|\bstorefront glazing\b|\bglazing\b/i;
const INTERIOR_BUILTIN_ASSET_REGEX = /\blower cabinet runs?\b|\bcabinet runs?\b|\bcabinet sections?\b|\bcabinet doors?\b|\bwall cabinets?\b|\bbase cabinets?\b|\bupper cabinets?\b|\blower cabinets?\b|\buppers\b|\blowers\b|\bcabinets?\b|\bshelves\b|\bshelf\b|\bshelving\b|\bcasework\b|\bmillwork\b|\bbuilt[-\s]?ins?\b|\bvanit(?:y|ies)\b|\blocker units?\b|\blockers?\b|\bbuilt[-\s]?in benches?\b|\bbenches?\b|\bstorage units?\b|\bwall-mounted storage(?: units?)?\b/i;
const DOOR_HARDWARE_ASSET_REGEX = /\bdoor closers?\b|\bclosers?\b|\bstorefront hardware\b|\bdoor hardware\b|\bpanic hardware\b|\bexit devices?\b|\b(?:cabinet\s+)?hinge pins?\b|\b(?:cabinet\s+)?hinges?\b|\blatch(?:es)?\b|\blocks?\b|\brekey(?:ed|ing)?\b|\bhandles?\b|\bpulls?\b|\bknobs?\b|\blevers?\b|\bstrikers?\b|\bdoor sweeps?\b|\bsweeps?\b|\bthresholds?\b|\bweather[-\s]?strips?\b|\bweatherstrips?\b|\bgaskets?\b|\brollers?\b|\bguides?\b|\btrack hardware\b|\bdrawer slides?\b/i;
const SITE_HARDWARE_ASSET_REGEX = /\bsigns?\b|\bmounted signs?\b|\bsign posts?\b|\bfence sections?\b|\bfence gates?\b|\bfencing\b|\bfence\b|\bposts?\b|\bbollards?\b|\bgates?\b|\bguardrail sections?\b|\bguardrails?\b|\brailing sections?\b|\brailings?\b|\bhandrail sections?\b|\bhandrails?\b|\bcanopy panel sections?\b|\bcanop(?:y|ies)\b|\bpost brackets?\b/i;
const FINISH_SURFACE_ASSET_REGEX = /\bfrp(?:\s+wall\s+panels?)?\b|\bfrp\b|\bceiling tiles?\b|\bacoustic ceiling tiles?\b|\btile(?:s)?\b|\bvct\b|\bvinyl composition tile\b/i;
const REPAIR_SURFACE_ASSET_REGEX = /\bstucco(?:\s+cracks?)?\b|\bdrywall\b|\bcurbs?\b|\bstorefront frame\b/i;
const GENERAL_EQUIPMENT_ASSET_REGEX = /\bappliances?\b|\bgate operators?\b|\bmounted equipment\b|\butility-connected equipment\b|\bequipment\b(?!\s+(?:support\s+)?brackets?\b)|\bunits?\b|\bfixtures?\b/i;
const OPENING_ASSEMBLY_OBJECT_REGEX = /\bwindows?\b|\bskylights?\b|\bwall louvers?\b|\blouvers?\b|\broof hatch(?:es)?\b|\bhatch(?:es)?\b|\bman doors?\b|\baccess doors?\b|\bpanel doors?\b|\bdoors?\b|\bstorefront doors?\b|\bstorefront windows?\b|\bstorefront glass\b|\bstorefront glazing\b|\baccess panels?\b|\bopenings?\b/i;
const FRAMED_OPENING_OBJECT_REGEX = /\bwindows?\b|\bskylights?\b|\bman doors?\b|\bdoors?\b|\bstorefront doors?\b|\bstorefront windows?\b|\bstorefront glass\b|\bstorefront glazing\b|\broof hatch(?:es)?\b|\bhatch(?:es)?\b/i;
const PANEL_CLOSURE_OBJECT_REGEX = /\baccess panel assemblies?\b|\baccess panels?\b|\bglazing panels?\b|\bpanel sections?\b|\bcover panels?\b|\bcover panel\b|\bwall flashing\b|\bflashing\b|\bclosure panels?\b|\bcanopy panel sections?\b|\bcanopy panels?\b|\bwall panel sections?\b|\bwall panels?\b|\bmetal panels?\b|\belectrical boxes?\b|\bbox covers?\b|\bpanels?\b/i;
const LOW_LEVEL_TRIM_COMPONENT_REGEX = /\bcorner beads?\b|\bbeads?\b|\btrim pieces?\b|\btrim sections?\b|\btrim corners?\b|\bwindow trim corners?\b|\bwindow trim\b|\bcorner trim\b|\bbaseboard ends?\b|\bfascia pieces?\b|\bedge trim\b|\bstop trim\b|\bcasing pieces?\b|\baccessory trim\b/i;
const TRIM_ACCESSORY_OBJECT_REGEX = /\bwindow trim\b|\btrim\b|\bfascia boards?\b|\bfascia\b|\bsoffit trim\b|\bcorner bead\b|\bcorner trim\b|\btrim pieces?\b|\btrim sections?\b|\btrim corners?\b|\bbaseboard ends?\b|\bfascia pieces?\b|\bedge trim\b|\bstop trim\b|\bcasing pieces?\b|\baccessory trim\b|\bcabinet doors?\b|\bwall cabinets?\b|\bbase cabinets?\b|\bcabinets?\b|\bshelves\b|\bshelf\b|\bshelving\b|\bcasework\b|\bmillwork\b|\bbuilt[-\s]?ins?\b|\blocker units?\b|\bbenches?\b|\bstorage units?\b|\baccessory\b|\bcap\b/i;
const MINOR_HARDWARE_COMPONENT_REGEX = /\bsupport brackets?\b|\bwall brackets?\b|\bpost brackets?\b|\bpanel supports?\b|\bcover plates?\b|\bpanel covers?\b|\bpost caps?\b|\btrim caps?\b|\bdoor hardware\b|\bfastener points?\b|\b(?:support\s+)?brackets?\b|\bsupports?\b|\bbraces?\b|\bhardware\b|\blatch(?:es)?\b|\bhinges?\b|\blocks?\b|\bhandles?\b|\bpulls?\b|\bknobs?\b|\blevers?\b|\bstrikers?\b|\bcaps?\b|\bcovers?\b|\bclips?\b/i;
const SITE_COMPONENT_CONTEXT_REGEX = /\bpost brackets?\b|\bguardrails?\b|\brailings?\b|\bhandrails?\b|\bfence(?:\s+(?:section|gate|post))?s?\b|\bgates?\b|\bposts?\b|\bbollards?\b|\bcanop(?:y|ies)\b/i;
const FRAME_PERIMETER_OBJECT_REGEX = /\b(?:storefront\s+)?(?:door\s+|window\s+)?frames?\b/i;
const PERIMETER_ACCESSORY_OBJECT_REGEX = /\bsealant\b|\bcaulk(?:ing)?\b|\bweather[-\s]?strips?\b|\bweatherstrips?\b|\bperimeter seals?\b|\bedge seals?\b|\bframe seals?\b|\bgaskets?\b/i;
const OPENING_PERIMETER_OBJECT_REGEX = /\bwindows?\b|\bskylights?\b|\bwall louvers?\b|\blouvers?\b|\broof hatch(?:es)?\b|\bhatch(?:es)?\b|\bstorefront doors?\b|\bstorefront windows?\b|\bstorefront glass\b|\bstorefront glazing\b|\bman doors?\b|\bdoors?\b|\baccess panels?\b|\belectrical boxes?\b|\bflashing\b|\bframes?\b|\bpanels?\b|\bopenings?\b/i;
const MOUNTED_ASSEMBLY_OBJECT_REGEX = /\bawnings?\b|\bwall louvers?\b|\bmounted\b|\bcanop(?:y|ies)\b/i;
const ANCHORED_ASSEMBLY_OBJECT_REGEX = /\bguardrails?\b|\bguardrail sections?\b|\brailings?\b|\bhandrails?\b|\bawnings?\b|\bbollards?\b|\bposts?\b|\bbrackets?\b|\bsupports?\b|\bgates?\b/i;
const WEATHER_CLOSURE_OBJECT_REGEX = /\bwindows?\b|\bskylights?\b|\bflashing\b|\blouvers?\b|\bhatch(?:es)?\b|\bstorefront\b|\bframes?\b|\bsealant\b|\bcaulk\b|\bweather[-\s]?strips?\b|\bweatherstrips?\b|\bgaskets?\b/i;
const OPENING_OPERATION_OBJECT_REGEX = /\bwindows?\b|\bman doors?\b|\bhatch(?:es)?\b|\blouvers?\b|\baccess doors?\b|\bpanel doors?\b/i;
const RESIDENTIAL_CONTEXT_REGEX = /\bresidential\b|\bhouse\b|\bhome\b|\bapartment\b|\bcondo\b/i;
const DAMAGED_OBJECT_CONTEXT_REGEX = /\bbad\b|\bdamaged\b|\bbroken\b|\bfailed\b|\bloose\b|\bcracked\b|\brusted\b|\brot(?:ten)?\b|\brotted\b|\bwet\b|\bsoft\b|\bsagging\b|\bbent\b|\bstained\b/i;
const WATER_DAMAGE_CONTEXT_REGEX = /\bwater got in\b|\bwater came in\b|\bwater damage\b|\bvisible leak damage\b|\bleak(?:ed|ing)?(?:\s+damage)?\b|\bleak area\b|\bstained ceiling\b|\bwet\b|\bmoisture\b/i;
const ROUGH_HOLE_CREATION_REGEX = /\b(?:punch|drill|core|cut|bore)\b(?:\s+(?:in|through))?(?:\s+holes?)?\b|\bpunch\s+holes?\b/i;
const WELDED_CONNECTION_METHOD_REGEX = /\bweld(?:ed|ing)?(?:\s+back)?\b|\btack(?:ed|ing)?\b|\bburn(?:ed|ing)?\s+in\b/i;
const ANCHORAGE_METHOD_REGEX = /\banchor(?:ed|ing)?(?:\s+(?:it\s+|them\s+)?(?:back\s+)?down)?\b|\bbolt(?:ed|ing)?(?:\s+(?:(?:it\s+|them\s+)?(?:back\s+)?)?(?:up|down))?\b|\bfasten(?:ed|ing)?(?:\s+(?:it\s+|them\s+)?back)?\s+off\b|\bsecure(?:d|ing)?(?:\s+(?:it|them|back))?\b|\bscrew(?:d|ing)?(?:\s+(?:it|them))?\s+back\s+on\b|\bpin(?:ned|ning)?(?:\s+(?:it|them))?\s+back\b|\breattach(?:ed|ing)?\b|\btie(?:-| )?in(?:s)?\b/i;
const PERIMETER_SEAL_METHOD_REGEX = /\bseal(?:ed|ing)?(?:\s+(?:around|it|them))?\b|\bre-?caulk(?:ed|ing)?(?:\s+(?:around|it|them))?\b|\bcaulk(?:ed|ing)?(?:\s+(?:around|it|them))?\b|\bwaterproof(?:ed|ing)?\b|\bfailed sealant\b|\bfailed caulk(?:ing)?\b|\bfailed caulking\b|\bweather[-\s]?strips?\b|\bweatherstrips?\b|\bperimeter seals?\b|\bedge seals?\b|\bframe seals?\b|\bgaskets?\b/i;
const WIRE_UP_METHOD_REGEX = /\bwire(?:d|ing)?\s+(?:it\s+|them\s+)?up\b/i;
const PERIMETER_FLASHING_METHOD_REGEX = /\bflash(?:ed|ing)?(?:\s+(?:it|them|around))?\b/i;
const JOINT_FINISH_METHOD_REGEX = /\bmud(?:ding)?(?:\s+and\s+tape)?\b|\btape(?:d|ing)?(?:\s+and\s+mud(?:ding)?)?\b|\bskim(?:med|ming)?\b/i;
const FLOAT_BLEND_METHOD_REGEX = /\bfloat(?:ed|ing)?(?:\s+(?:it|them))?\b|\bblend(?:ed|ing)?\b/i;
const FIT_ADJUST_METHOD_REGEX = /\bshim(?:med|ming)?(?:\s+(?:it|them))?\b|\blevel(?:ed|ing)?\b|\bplumb\b|\bsquare\b|\balign(?:ed|ing)?\b/i;
const PENETRATION_SLEEVE_METHOD_REGEX = /\bsleeve(?:d|ing)?(?:\s+(?:it|them))?\b/i;
const POST_WRAP_METHOD_REGEX = /\bwrap(?:ped|ping)?\s+posts?\b/i;
const CLOSURE_CAP_METHOD_REGEX = /\bcap(?:ped|ping)?(?:\s+(?:it|them|off))?\b/i;
const SITE_PERIMETER_ASSEMBLY_REGEX = /\bfence(?:\s+(?:line|section|panel|gate))?s?\b|\bfencing\b|\bchain[-\s]?link\b|\biron fence\b/i;
const GATE_ASSEMBLY_REGEX = /\bgate(?:\s+section)?s?\b/i;
const RAILING_ASSEMBLY_REGEX = /\bguardrails?\b|\bguardrail sections?\b|\brailings?\b|\bhandrails?\b/i;
const PANEL_ASSEMBLY_REGEX = /\bcanopy panels?\b|\bmetal panels?\b|\bwall panels?\b|\baccess panels?\b/i;
const PLACEHOLDER_TARGET_REGEX = /^(?:new\s+)?(?:one|ones|it|them)$/i;
const VAGUE_REPAIR_ACTION_REGEX = /\bfix(?:ed|ing)?\b|\bredo\b|\btouch(?:ed|ing)?\s+up\b|\bmake\s+good\b|\bclean up damage\b|\bclose(?:d|ing)?\s+up\b|\bclose\s+in\b|\btighten(?:ed|ing)?\b|\badjust(?:ed|ing)?\b|\balign(?:ed|ing)?\b|\blevel(?:ed|ing)?\b|\bplumb\b|\bsquare\b|\brekey(?:ed|ing)?\b/i;
const CONDITION_REPLACEMENT_BIAS_REGEX = /\bbad\b|\bbroken\b|\bdamaged\b|\bfailed\b|\brusted\b|\brot(?:ten)?\b|\brotted\b/i;
const CONDITION_REPAIR_BIAS_REGEX = /\bloose\b|\bcracked\b|\bwet\b|\bwater damage\b|\bleak(?:\s+damage)?\b|\bmoisture\b|\bfailed sealant\b|\bfailed caulk(?:ing)?\b|\bfailed caulking\b|\bsoft\b|\bsagging\b|\bbent\b|\bstained\b/i;
const PERIMETER_SCOPE_HINT_REGEX = /\baround\b|\bperimeter\b|\bseal(?:ant)?\s+around\b|\bcaulk(?:ing)?\s+around\b|\btrim\s+around\b|\bpatch\s+around\b|\brepair\s+around\b|\bmake\s+good\s+around\b|\bflash(?:ing)?\s+around\b|\bwindow perimeter\b|\bdoor perimeter\b|\bframe seal\b|\bedge seal\b/i;
const PARTIAL_SCOPE_HINT_REGEX = /\bsection\b|\bside\b|\bcorner\b|\bpiece\b|\bportion\b|\barea\b|\baffected area\b|\bone side\b|\bone section\b|\bbottom piece\b|\blower\b|\bupper\b|\bend\b|\bedge\b|\brun\b|\belevation\b/i;
const MID_LEVEL_ADJACENT_MAKE_GOOD_REGEX = /\bmake\s+good\b(?:\s+\w+){0,4}\s+\b(?:wall|finish|area)\b|\bpatch(?:ed|ing)?\b(?:\s+\w+){0,4}\s+\b(?:wall|finish|area)\b|\b(?:wall|finish|surrounding wall area)\b(?:\s+\w+){0,4}\s+\b(?:after|around)\b/i;
const MID_LEVEL_FINISH_FOLLOWUP_REGEX = /\bpatch(?:ed|ing)?(?:\s+\w+){0,4}\s+\b(?:and|then)\s+(?:re)?paint(?:ed|ing)?\b|\bpatch(?:ed|ing)?(?:\s+\w+){0,4}\s+\btexture(?:d|ing)?\b|\bpaint(?:ed|ing)?\b|\brepaint(?:ed|ing)?\b|\btexture(?:d|ing)?\b|\bblend(?:ed|ing)?\b|\bmake\s+good\b/i;
const MID_LEVEL_PERIMETER_FOLLOWUP_REGEX = /\bseal(?:ed|ing)?(?:\s+(?:around|perimeter))\b|\bcaulk(?:ed|ing)?(?:\s+(?:around|perimeter))\b|\bre-?caulk(?:ed|ing)?(?:\s+(?:around|perimeter))\b|\bflash(?:ed|ing)?(?:\s+(?:around|perimeter))\b|\btrim\s+around\b/i;
const MID_LEVEL_SECUREMENT_FOLLOWUP_REGEX = /\bsecure(?:d|ing)?\b|\bre-?secure(?:d|ing)?\b|\balign(?:ed|ing)?\b|\bbolt(?:ed|ing)?(?:\s+(?:it|them|back))?(?:\s+(?:up|down))?\b|\banchor(?:ed|ing)?(?:\s+(?:it|them))?(?:\s+down)?\b|\bweld(?:ed|ing)?\b/i;
const RESET_SCOPE_HINT_REGEX = /\bremove and reinstall\b|\btake down and reinstall\b|\bdetach and reinstall\b|\bdetach\b.*\breinstall\b|\bpull and resecure\b|\bpull panel and reset\b|\bremove panel for access and reinstall\b|\bremove trim and reinstall\b|\bremove for access and put back\b|\breinstall\b|\breset\b|\bput back\b|\bresecure\b/i;
const TEMPORARY_RESET_REASON_REGEX = /\bafter repair\b|\bafter access\b|\bfor access\b|\badjacent repair\b/i;
const OPENING_CLOSURE_HINT_REGEX = /\bold opening\b|\bold door opening\b|\bopenings?\b|\bclose in\b|\bclose(?:\s+it)?\s+up\b|\baccess doors?\b|\bpanel doors?\b/i;
const LOCATION_CONTEXT_HINT_PATTERNS = [
  { label: "side_yard", regex: /\bside yard\b/i },
  { label: "backyard", regex: /\bbackyard\b/i },
  { label: "front_entry", regex: /\bfront entry\b/i },
  { label: "rear_entry", regex: /\brear entry\b/i },
  { label: "rear_stair", regex: /\brear stair\b/i },
  { label: "front_canopy", regex: /\bfront canopy\b/i },
  { label: "roof_edge", regex: /\broof edge\b/i },
  { label: "roof", regex: /\broof\b|\brooftop\b/i },
  { label: "storefront_front", regex: /\bstorefront front\b/i },
  { label: "back_side", regex: /\bback side\b|\brear side\b/i },
  { label: "rear_wall", regex: /\brear wall\b/i },
  { label: "west_wall", regex: /\bwest wall\b/i },
  { label: "bedroom", regex: /\bbedrooms?\b/i },
  { label: "side_gate", regex: /\bside gate\b/i },
  { label: "ceiling_edge", regex: /\bceiling edge\b/i },
  { label: "wall_edge", regex: /\bwall edge\b/i },
  { label: "kitchen", regex: /\bkitchen\b/i },
  { label: "laundry_room", regex: /\blaundry(?:\s+room)?\b/i },
  { label: "office", regex: /\boffice\b/i },
  { label: "lobby", regex: /\blobby\b/i },
  { label: "storefront", regex: /\bstorefront\b/i },
  { label: "storage_room", regex: /\bstorage room\b/i },
  { label: "breakroom", regex: /\bbreakroom\b/i },
  { label: "waiting_area", regex: /\bwaiting area\b/i },
  { label: "reception_wall", regex: /\breception wall\b/i },
  { label: "wet_area", regex: /\bbath(?:room)?\b|\brestroom\b/i },
];
const CONNECTED_EQUIPMENT_FAMILY_REGEX = /\bwater heaters?\b|\btankless water heaters?\b|\btoilet(?:s)?\b|\bsinks?\b|\bfaucets?\b|\bdrinking fountains?\b|\bmop sinks?\b|\bplumbing fixtures?\b|\bexhaust fans?\b|\brestroom fans?\b|\bvent fans?\b|\bvents?\b|\brooftop fans?\b|\brooftop units?\b|\brtu\b|\bcondensers?\b|\bair handlers?\b|\bmini[\s-]?splits?\b|\bdisconnect(?:s)?\b|\bbreakers?\b|\b(?:electrical|distribution|control|switchgear|breaker|existing|new)\s+panels?\b|\bpanelboards?\b|\blight fixtures?\b|\blighting fixtures?\b|\bhigh[-\s]?bay(?:\s+light(?:ing)?)?\s+fixtures?\b|\bappliances?\b|\bgate operators?\b|\bmounted equipment\b|\butility-connected equipment\b|\bequipment\b(?!\s+(?:support\s+)?brackets?\b)|\bunits?\b|\bfixtures?\b/i;
const NON_CONNECTED_ASSET_FAMILY_REGEX = /\bdoors?\b|\bdoor closers?\b|\bclosers?\b|\bstorefront hardware\b|\bdoor hardware\b|\bpanic hardware\b|\bexit devices?\b|\bhinges?\b|\blatch(?:es)?\b|\bcabinet doors?\b|\bwall cabinets?\b|\bbase cabinets?\b|\buppers?\b|\blowers?\b|\bcabinets?\b|\bshelves\b|\bshelf\b|\bshelving\b|\bcasework\b|\bmillwork\b|\bbuilt[-\s]?ins?\b|\blocker units?\b|\bbenches?\b|\bstorage units?\b|\bsigns?\b|\bmounted signs?\b|\bsign posts?\b|\bfence sections?\b|\bfence gates?\b|\bfence\b|\bposts?\b|\bbollards?\b|\bgates?\b|\bcanop(?:y|ies)\b|\bcover panels?\b/i;
const STOREFRONT_OPENING_FAMILY_REGEX = /\bstorefront windows?\b|\bstorefront glass\b|\bstorefront frame\b|\bstorefront glazing\b|\bglazing\b|\bstorefront hardware\b/i;
const FINISH_MATERIAL_FAMILY_REGEX = /\bfrp(?:\s+wall\s+panels?)?\b|\bfrp\b|\bwall panels?\b|\bceiling tiles?\b|\bacoustic ceiling tiles?\b|\btile(?:s)?\b|\bvct\b|\bvinyl composition tile\b|\bflooring\b/i;
const REPAIR_DAMAGE_FAMILY_REGEX = /\bstucco(?:\s+finish|\s+cracks?)?\b|\bdrywall\b|\bcurbs?\b|\bcracks?\b|\bstorefront frame\b/i;
const SITE_EXTERIOR_CONTEXT_REGEX = /\bsite\b|\bexterior\b|\boutdoor\b|\bbackyard\b|\bparking lot\b|\bhotel\b|\bcanop(?:y|ies)\b|\bbollards?\b|\bfence(?:\s+(?:section|gate))?s?\b|\bmounted signs?\b|\bsign posts?\b|\bpole lights?\b|\blight poles?\b|\brooftop\b|\bskylights?\b|\bawnings?\b|\bguardrails?\b|\bhandrails?\b|\brailings?\b|\bfascia\b|\bflashing\b|\bwall louvers?\b/i;
const ROOFTOP_ACCESS_IMPLIED_REGEX = /\brooftop\b|\brtu\b|\bpackage unit\b|\brooftop fans?\b|\bskylights?\b|\broof hatch(?:es)?\b/i;
const LIFT_ACCESS_IMPLIED_REGEX = /\bpole lights?\b|\blight poles?\b|\blight standards?\b|\bmounted signs?\b|\bhigh[-\s]?bay(?:\s+light(?:ing)?)?\s+fixtures?\b|\bcanop(?:y|ies)\b|\bawnings?\b|\bwall louvers?\b/i;
const SAFE_HANDLING_ACCESS_IMPLIED_REGEX = /\bwindows?\b|\bskylights?\b|\bstorefront windows?\b|\bstorefront glass\b|\bstorefront frame\b|\bfence sections?\b|\bgate sections?\b|\bbollards?\b/i;

// Mid-band ambiguity control constants
// Matches items that are only generic extent/size words — no real construction noun
const MID_BAND_WEAK_EXTENT_ITEM_REGEX = /^(?:(?:affected|damaged|bad|old|worn|broken|failed|cracked|soft|loose|stained|visible|dirty)\s+)?(?:area|section|part|piece|spot|place|zone|location|thing|damage)s?(?:\s+(?:here|there|above|below))?$/i;
// Generic construction surface nouns — real but scoped; keep repair bounded, not full system
const MID_BAND_GENERIC_SURFACE_REGEX = /\b(?:wall|ceiling|floor(?:ing)?|drywall|plaster|stucco|substrate|concrete|masonry|slab|tile|paint(?:ed)?\s+surface|rough\s+surface)\b/i;
// Named construction objects that have strong existing routing and bypass ambiguity control
const MID_BAND_STRONG_OBJECT_REGEX = /\b(?:fence(?:s|ing)?|railing(?:s)?|guardrail(?:s)?|handrail(?:s)?|gate(?:s)?|storefront|glazing(?:\s+panel(?:s)?)?|glass\s+panel(?:s)?|cabinet(?:ry|s)?|casework|millwork|vanit(?:y|ies)|shelv(?:ing|es)|locker(?:s)?|bench(?:es)?|man\s+door|hollow\s+metal|entry\s+door|access\s+panel|roof\s+hatch|skylight(?:s)?|canop(?:y|ies)|built.in(?:s)?|opening(?:s)?|bollard(?:s)?|post(?:s)?)\b/i;
// Full scope escalation overrides mid-band bias
const MID_BAND_FULL_SCOPE_ESCALATION_REGEX = /\b(?:entire|whole|full\s+(?:wall|ceiling|floor|system|assembly|surface|building)|all\s+of(?:\s+the)?|complete\s+(?:wall|ceiling|system|assembly)|throughout|every\s+(?:wall|surface|area|section))\b/i;
// Action verbs used in clause splitting to detect compound action pairs ("patch and paint", "remove and replace")
const MID_BAND_CLAUSE_ACTION_VERB_REGEX = /^(?:repair|patch|paint|replace|remove|install|align|seal|apply|clean|prep|prime|finish|restore|grout|caulk|fill|fix|redo|make|demo|rebuild|add|secure|fasten|anchor|treat|coat|wrap|cover|frame|trim|cut|fit|adjust|reinforce|strip)s?$/i;
// Noun-position cue words: when an overloaded term (trim, seal, finish, cover, etc.) follows one of these,
// it is likely a NOUN (object target) rather than an ACTION VERB — prevents incorrect compound-pair fusion
const OVERLOADED_NOUN_POSITION_CUES_REGEX = /^(?:the|a|an|this|that|these|those|replace|install|remove|repair|fix|redo|reset|new|old|existing|damaged|bad|worn|paint-grade)$/i;

// Demonstrative modifier detection constants
// this/that/these/those + weak extent word: section, area, zone, opening area
const DEMONSTRATIVE_WEAK_EXTENT_REGEX = /\b(?:this|that|these|those)\s+(?:(?:affected|damaged|bad|old|worn|broken|failed|cracked|soft|loose|stained|visible|dirty)\s+)?(?:area|section|part|piece|spot|place|zone|location|damage|opening\s+area)s?\b/i;
// this/that/these/those + generic surface noun: wall, ceiling, floor, drywall, etc.
const DEMONSTRATIVE_GENERIC_SURFACE_REGEX = /\b(?:this|that|these|those)\s+(?:(?:damaged|affected|bad|old|stained|cracked|dirty|visible)\s+)?(?:wall|ceiling|floor(?:ing)?|drywall|plaster|stucco|substrate|concrete|masonry|slab|tile)(?:\s+(?:area|section|surface|areas|sections))?\b/i;
// this/that/these/those + bounded construction object: panel, trim, door, frame, seal, finish, cap, anchor,
// brace, bolt, flashing, texture, cover (specific but not in STRONG list; includes overloaded noun forms)
const DEMONSTRATIVE_BOUNDED_OBJECT_REGEX = /\b(?:this|that|these|those)\s+(?:panel(?:s)?|trim(?:s)?|door(?:s)?|frame(?:\s+area)?|cover(?:\s+panel)?|seal(?:s)?|finish|cap(?:s)?|anchor(?:s)?|brace(?:s)?|bolt(?:s)?|flashing(?:s)?|texture)\b/i;
// this/that/these/those + strong named construction object (mirrors MID_BAND_STRONG_OBJECT_REGEX)
const DEMONSTRATIVE_STRONG_OBJECT_REGEX = /\b(?:this|that|these|those)\s+(?:glazing(?:\s+panel(?:s)?)?|glass\s+panel(?:s)?|fence(?:s|ing)?|railing(?:s)?|guardrail(?:s)?|handrail(?:s)?|gate(?:s)?|storefront|cabinet(?:ry|s)?|casework|millwork|vanit(?:y|ies)|shelv(?:ing|es)|locker(?:s)?|man\s+door|hollow\s+metal|entry\s+door|access\s+panel|roof\s+hatch|skylight(?:s)?|canop(?:y|ies)|built.in(?:s)?|bollard(?:s)?|post(?:s)?)\b/i;

// Multi-anchor zone separation: detects explicit "at/in [location]" anchors within a single clause.
// A clause qualifies as anchored if it has its own stated spatial location (e.g., "at entry", "in bathroom").
// When ≥ 2 clauses are each anchored, cross-clause anchor bleed must be suppressed.
const CLAUSE_LOCATION_ANCHOR_REGEX = /\b(?:at|in)\s+(?:the\s+)?(?:(?:rear|front|side|interior|adjacent|office|lobby|hallway|bedroom|storefront|loading|dining|conference)\s+)?(?:entry|lobby|window|door(?:way)?|hallway|corridor|bathroom|kitchen|restroom|vestibule|stair(?:well)?|landing|alley|yard|elevation|wall|dock|area|room|side)\b/i;

// Referential follow-up detection constants
// "around it", "around them", "around frame", "around opening", "around base", "around post", "around door"
const REFERENTIAL_PERIMETER_PATTERN_REGEX = /\baround\s+(?:it|them|this|that|frame|opening|perimeter|base|post|door)\b/i;
// "seal it", "paint it", "weld it up", "secure it", "finish it", "patch around it", etc.
const REFERENTIAL_ACTION_PRONOUN_REGEX = /\b(?:seal|paint|blend|prime|coat|caulk|weld|secure|tighten|fix|finish|make\s+good|patch)\s+(?:around\s+)?(?:it|them|this|that)\b/i;
// "adjacent wall area", "adjacent surface", "surrounding area", "nearby area"
const REFERENTIAL_ADJACENT_AREA_REGEX = /\b(?:adjacent(?:\s+(?:wall|area|surface|section))?|surrounding\s+(?:area|surface|wall)|nearby\s+(?:area|surface|wall))\b/i;
// "after install", "after replacement", "after work", "after that", bare "after" as follow-up signal
const REFERENTIAL_AFTER_WORK_REGEX = /\b(?:after(?:\s+(?:install(?:ation)?|replacement|work|that))?|following\s+(?:install(?:ation)?|replacement|work))\b/i;

// Relative/comparative zone detection constants (Pass 7)
// Per-clause anchor: detects a relative spatial zone within a single clause, even without a named location noun.
// Covers: side contrast (left/right/other/one side), interior/exterior (inside/outside face/perimeter),
// front/rear/back side, same/adjacent/nearby zone, and bare inside/outside at clause end.
const CLAUSE_RELATIVE_ZONE_REGEX = /\b(?:left|right|front|rear|back|opposite|other|same|one|this)\s+side\b|\bthe\s+other\b|\b(?:inside|outside|interior|exterior)\s+(?:side|face|edge|perimeter|wall|frame|surface)\b|\b(?:same|adjacent|nearby)\s+(?:wall(?:\s+area)?|area|section|surface|opening)\b|\b(?:patch|seal|repair|finish|replace|coat|trim)\s+(?:the\s+)?(?:inside|outside)\b|\bon\s+(?:the\s+)?(?:inside|outside)\b|\b(?:inside|outside)$/i;
// Full-text hint regexes — categorize what type of relative zone language is present
const RELATIVE_SIDE_CONTRAST_REGEX = /\b(?:left|right|one|this|other|opposite)\s+side\b|\bthe\s+other\s+side\b|\bother\s+side\b/i;
const RELATIVE_INTERIOR_EXTERIOR_REGEX = /\b(?:inside|outside|interior|exterior)\s+(?:side|face|edge|perimeter|wall|frame|surface)\b|\b(?:interior|exterior)\s+side\b|\b(?:patch|seal|repair|finish|replace|trim)\s+(?:the\s+)?(?:inside|outside)\b|\bon\s+(?:the\s+)?(?:inside|outside)\b/i;
const RELATIVE_FRONT_REAR_REGEX = /\b(?:front|rear|back)\s+side\b|\b(?:front|rear|back)\s+(?:face|edge|surface)\b/i;
const RELATIVE_SAME_ZONE_REGEX = /\bsame\s+(?:wall|area|section|surface|opening|side|spot)\b/i;
const RELATIVE_OPPOSITE_REGEX = /\bopposite\s+side\b|\bopposite\s+(?:face|edge|wall|area)\b/i;
const RELATIVE_ADJACENT_NEARBY_REGEX = /\badjacent\s+(?:area|section|wall(?:\s+area)?|surface)\b|\bnearby\s+(?:area|section|surface)\b/i;

// Sparse directional zone shorthand (Pass 8)
// Detects action verb + (the) + bare directional zone word when used as a bounded clause-local target.
// Zone words: inside, outside, interior, exterior, front, rear, back, side, edge, center, middle, left, right.
// Used for both full-text hint detection and per-clause 3+-chain counting.
const SPARSE_DIRECTIONAL_ZONE_REGEX = /\b(?:repair|patch|seal|paint|prime|coat|finish|blend|fill|trim|replace|fix|clean|prep|apply|restore|caulk|grout|redo|smooth|float)\s+(?:the\s+)?(?:inside|outside|interior|exterior|front|rear|back|side|edge|center|middle|left|right)\b/i;

// Coverage / extent quantifier constants (Pass 9)
// Both sides / both ends / both [surface noun] — dual-local coverage modifier
const COVERAGE_BOTH_SIDES_REGEX = /\bboth\s+(?:sides?|ends?|faces?|(?:wall\s+)?sections?)\b|\bboth\s+sides?\s+of\b/i;
// All around / all the way around / full perimeter / all edges / all sides — wraparound/perimeter coverage
const COVERAGE_PERIMETER_REGEX = /\ball\s+(?:the\s+way\s+)?around\b|\b(?:full|whole)\s+(?:(?:outside|rear|front|frame|inner)\s+)?perimeter\b|\ball\s+(?:edges?|sides?)\b/i;
// Entire / whole / full [surface noun] — whole local surface coverage (not run/span/edge extents)
const COVERAGE_WHOLE_SURFACE_REGEX = /\b(?:entire|whole)\s+(?:wall(?:\s+(?:area|section|face))?|ceiling(?:\s+(?:area|section))?|section|face|surface|opening\s+area|rear\s+side|inside\s+face|outside\s+face)\b|\bfull\s+(?:wall(?:\s+(?:area|section))?|ceiling(?:\s+(?:area|section))?|rear\s+side|inside\s+face|outside\s+face|middle\s+section|rear\s+wall)\b/i;
// Rest of / remaining / other half — remainder / partial-balance coverage
const COVERAGE_REMAINDER_REGEX = /\brest\s+of(?:\s+the)?\s+(?:wall(?:\s+(?:face|area|section))?|ceiling(?:\s+(?:section|area))?|opening(?:\s+area)?|section|area|span)\b|\bremaining\s+(?:wall(?:\s+(?:face|area|section))?|ceiling\s+(?:section|area)|area|side|section|face|span)\b|\b(?:the\s+)?other\s+half(?:\s+of(?:\s+the)?\s+(?:wall|ceiling|section|area|span))?\b/i;
// Full run / full span / full edge / entire edge — linear run/span/edge extent coverage
const COVERAGE_RUN_SPAN_EDGE_REGEX = /\bfull\s+(?:run|span|edge|front\s+edge|rear\s+edge|outside\s+edge|middle\s+span|fence\s+section(?:\s+span)?|cabinet\s+run|railing\s+section)\b|\bthe\s+entire\s+edge\b/i;

// Ordinal / count / stacked extent constants (Pass 10)
// Ordinal local selection: first/second/third/last/middle/center/end + local construction noun
const ORDINAL_LOCAL_SELECTOR_REGEX = /\b(?:the\s+)?(?:first|second|third|fourth|fifth|last|middle|center|end)\s+(?:and\s+(?:first|second|third|fourth|fifth|last|middle|end)\s+)?(?:two\s+)?(?:section(?:s)?|panel(?:s)?|run(?:s)?|bay(?:s)?|span(?:s)?|joint(?:s)?|railing\s+(?:section|span)|railing(?:s)?|wall\s+(?:section|area|face)(?:s)?|ceiling\s+(?:section|area)(?:s)?|opening\s+area(?:s)?|fence\s+(?:section|bay|panel)(?:s)?|glazing\s+panel(?:s)?|cabinet\s+(?:section|run|door)(?:s)?|face(?:s)?|area(?:s)?|edge(?:s)?|opening(?:s)?|door(?:s)?)\b/i;
// Count-based local extent: two/three/four/five + local construction noun
const COUNT_LOCAL_EXTENT_REGEX = /\b(?:two|three|four|five|2|3|4|5)\s+(?:section(?:s)?|panel(?:s)?|run(?:s)?|bay(?:s)?|span(?:s)?|joint(?:s)?|edge(?:s)?|area(?:s)?|opening(?:s)?|door(?:s)?|face(?:s)?|railing\s+section(?:s)?|wall\s+(?:section(?:s)?|area(?:s)?|face(?:s)?)|ceiling\s+section(?:s)?|fence\s+panel(?:s)?|cabinet\s+(?:run(?:s)?|door(?:s)?|section(?:s)?)|glazing\s+panel(?:s)?)\b/i;
// Stacked extent + directional modifier + local anchor
// Pattern A: coverage quantifier + one or more directional modifiers + extent noun (bounded local)
// Pattern B: directional/positional word + optional second modifier + extent noun + "of/at" anchor
const STACKED_EXTENT_LOCATION_REGEX = /\b(?:full|entire|whole|both|remaining)\s+(?:(?:outside|inside|outer|inner|rear|front|middle|upper|lower|side)\s+)+(?:perimeter|face(?:s)?|edge(?:s)?|span|half|ends?|run|section)\b|\b(?:both|rear|front|outer|inner|outside|inside|side|middle)\s+(?:(?:outer|inner|outside|inside|rear|front|middle)\s+)?(?:perimeter|face(?:s)?|edge(?:s)?|span|half|ends?|run)\s+(?:of|at)\b/i;

// Range / positional / fractional / mixed-anchor constants (Pass 11)
// Ordinal or numeric range selection: "sections 2 through 4", "panels 1-3", "first through third", "bays two to four"
const ORDINAL_RANGE_SELECTION_REGEX = /\b(?:section|panel|run|bay|span|joint)s?\s+(?:\d+\s*(?:through|to|[-–])\s*\d+|(?:one|two|three|four|five|six)\s+(?:through|to)\s+(?:two|three|four|five|six|seven))\b|\b(?:first|second|third|fourth|fifth)\s+through\s+(?:second|third|fourth|fifth|sixth)\b/i;
// Positional local selection: top/bottom/upper/lower + local noun, front/rear/back + local noun
const POSITIONAL_LOCAL_SELECTOR_REGEX = /\b(?:the\s+)?(?:top|bottom|upper|lower)\s+(?:(?:inside|outside|rear|front|inner|outer)\s+)?(?:panel(?:s)?|run(?:s)?|section(?:s)?|edge(?:s)?|face(?:s)?|span(?:s)?|bay(?:s)?|joint(?:s)?|wall\s+(?:section|face|area)(?:s)?|ceiling\s+(?:section|area)(?:s)?|cabinet\s+(?:run|section|door)(?:s)?|fence\s+(?:panel|section)(?:s)?|perimeter|area(?:s)?)\b|\b(?:the\s+)?(?:front|rear|back)\s+(?:(?:inside|outside|inner|outer)\s+)?(?:panel(?:s)?|run(?:s)?|section(?:s)?|span(?:s)?|face(?:s)?|edge(?:s)?|perimeter|area(?:s)?)\b/i;
// Fractional local extent: half/third/quarter + of/the + local noun; also directional + fraction + of noun
const FRACTIONAL_LOCAL_EXTENT_REGEX = /\b(?:(?:left|right|upper|lower|rear|front|top|bottom|middle)\s+)?(?:half|one[-\s]half|one[-\s]third|one[-\s]quarter|third|quarter|two[-\s]thirds?)\s+(?:of(?:\s+the)?|the)\s+(?:wall(?:\s+(?:area|section|face))?|ceiling(?:\s+(?:area|section))?|section|opening(?:\s+area)?|face|span|area|frame(?:\s+perimeter)?|panel|run|bay|perimeter)\b|\bhalf\s+the\s+(?:wall|ceiling|section|face|opening|panel|run|bay|span|area)\b/i;
// Mixed selection + location: ordinal/positional/count selector + local noun + explicit "at/on/in" anchor
const MIXED_SELECTION_LOCATION_REGEX = /\b(?:first|second|third|fourth|fifth|last|middle|center|top|bottom|upper|lower|front|rear)\s+(?:two\s+)?(?:section(?:s)?|panel(?:s)?|run(?:s)?|bay(?:s)?|span(?:s)?|railing(?:\s+section)?|wall\s+(?:section|area|face)(?:s)?|ceiling\s+section(?:s)?|fence\s+(?:panel|section)(?:s)?|cabinet\s+(?:run|door)(?:s)?|glazing\s+panel(?:s)?|face(?:s)?|edge(?:s)?|area(?:s)?|opening(?:s)?|door(?:s)?)\s+(?:at|on|in)\b|\b(?:two|three|four|five)\s+(?:section(?:s)?|panel(?:s)?|run(?:s)?|railing\s+section(?:s)?|wall\s+(?:section(?:s)?|area(?:s)?|face(?:s)?)|ceiling\s+section(?:s)?|fence\s+panel(?:s)?|cabinet\s+(?:run(?:s)?|door(?:s)?))\s+(?:at|on|in)\b/i;

// Anchor carry + "of" position + named sub-zone constants (Pass 12)
// Range + explicit anchor carry: ordinal/numeric range + "at/on/in/along" anchor suffix
const RANGE_ANCHOR_CARRY_REGEX = /\b(?:section|panel|run|bay|span|joint)s?\s+\d+\s*(?:through|to|[-–])\s*\d+\s+(?:at|on|in|along|near)\b|\b(?:first|second|third|fourth|fifth)\s+through\s+(?:second|third|fourth|fifth|sixth)(?:\s+(?:wall\s+areas?|sections?|panels?|runs?|bays?|spans?|joints?))?\s+(?:at|on|in|along|near)\b/i;
// Fraction + explicit anchor carry: fractional extent phrase + "at/on/in/along" anchor suffix
const FRACTION_ANCHOR_CARRY_REGEX = /\b(?:(?:left|right|upper|lower|rear|front|top|bottom|middle)\s+)?(?:half|one[-\s]half|one[-\s]third|one[-\s]quarter|third|quarter|two[-\s]thirds?)\s+of(?:\s+the)?\s+(?:wall(?:\s+(?:area|section|face))?|ceiling(?:\s+(?:area|section))?|section|opening(?:\s+area)?|face|span|area|panel|run|bay|perimeter)\s+(?:at|on|in|along|near)\b/i;
// Position "of" local: positional word + optional sub-part + "of" + local construction noun
const POSITION_OF_LOCAL_REGEX = /\b(?:top|bottom|upper|lower|front|rear|back|inside|outside|inner|outer)\s+(?:(?:edge|face|side|end|half|corner|section|portion)\s+)?of(?:\s+the)?\s+(?:wall(?:\s+(?:area|section|face))?|ceiling(?:\s+(?:area|section))?|opening(?:\s+area)?|frame(?:\s+perimeter)?|panel|run|bay|section|span|face|edge|surface|post|jamb|door|gate|railing|cabinet(?:\s+run)?|glazing|column|sill|threshold|perimeter)\b/i;
// Named construction sub-zones: specific named parts of an assembly
const NAMED_SUBZONE_REGEX = /\b(?:head\s+jamb|side\s+jamb|top\s+jamb|bottom\s+jamb|corner\s+jamb|sill\s+plate|wall\s+base|base\s+plate|center\s+mullion|side\s+mullion|horizontal\s+mullion|vertical\s+mullion|face\s+frame|bottom\s+rail|top\s+rail|mid\s+rail|center\s+rail|infield\s+section|edge\s+band|corner\s+bead|base\s+trim|head\s+trim|jamb\s+trim|brick\s+mold|stool\s+cap|parting\s+bead|meeting\s+rail|astragal|door\s+stop)\b/i;

// Coordinated local-distribution constants (Pass 13)
// Position distribution: two directional words joined by "and", or dir1+word(s)+and+dir2, or dir1 of noun and dir2 of
const COORDINATED_POSITION_DIST_REGEX = /\b(?:top|bottom|upper|lower|left|right|front|rear|back|inner|outer|inside|outside|side)\s+and\s+(?:top|bottom|upper|lower|left|right|front|rear|back|inner|outer|inside|outside|side)\b|\b(?:top|bottom|upper|lower|left|right|front|rear|back|inner|outer|inside|outside|side)\s+\w+\s+(?:\w+\s+)?and\s+(?:top|bottom|upper|lower|left|right|front|rear|back|inner|outer|inside|outside|side)\b|\b(?:top|bottom|upper|lower|front|rear)\s+of\s+\w+\s+and\s+(?:top|bottom|upper|lower|front|rear)\s+of\b/i;
// Selection distribution: two ordinal selectors joined by "and" or comma-list
const COORDINATED_SELECTION_DIST_REGEX = /\b(?:first|second|third|fourth|fifth|last)\s+and\s+(?:first|second|third|fourth|fifth|last)\b|\b(?:first|second|third|fourth|fifth|last)\s*,\s*(?:(?:first|second|third|fourth|fifth|last)\s*,\s*)*and\s+(?:first|second|third|fourth|fifth|last)\b/i;
// Local members: coordinated construction member terms not covered by position or selection patterns
const COORDINATED_LOCAL_MEMBERS_REGEX = /\b(?:head|side|top|bottom|corner)\s+and\s+(?:head|side|top|bottom|corner)\s+(?:jamb|rail|sill|base|trim|plate|mullion)\b|\b(?:head|side|top|bottom|corner)\s+(?:jamb|rail|sill|base|trim)\s+and\s+(?:sill|rail|jamb|base|plate|mullion|trim|bead)\b/i;

// Welding taxonomy normalization constants (Pass 14)
// Allied-but-not-welding: joining/heating processes that are not fusion welding
const ALLIED_NOT_WELDING_PROCESSES = [
  { canonical: "brazing", patterns: [/\bbraz(?:ing|e|ed|er)?\b/i, /\bsilver[\s-]?solder(?:ing)?\b/i] },
  { canonical: "soldering", patterns: [/\bsolder(?:ing|ed|er)?\b/i, /\bsweat(?:ing)?\s+(?:joint|connection|fitting|copper)\b/i] },
  { canonical: "thermal_spray", patterns: [/\b(?:thermal|metal|flame|hvof)\s+spray\b/i] },
  { canonical: "thermal_cutting", patterns: [/\bplasma\s+cut(?:ting)?\b/i, /\boxy[\s-]?(?:fuel|acetylene)\s+cut(?:ting)?\b/i, /\btorch\s+cut(?:ting)?\b/i, /\bgouging\b/i, /\bair[\s-]?arc\s+(?:cut|gouge)/i] },
  { canonical: "hot_forming", patterns: [/\bhot\s+(?:form(?:ing)?|bend(?:ing)?)\b/i, /\bheat\s+(?:form(?:ing)?|bend(?:ing)?)\b/i] },
  { canonical: "induction_heating", patterns: [/\binduction\s+heat(?:ing)?\b/i] },
];

// Base process registry — most specific first; welding_generic is catch-all fallback only
const WELDING_BASE_PROCESS_PATTERNS = [
  { key: "gtaw_tig", patterns: [/\bgtaw\b/i, /\btig\b(?:\s+weld(?:ing)?)?/i, /\bgas\s+tungsten(?:\s+arc)?\s+weld/i, /\btungsten\s+inert\s+gas\b/i] },
  { key: "gmaw_mig", patterns: [/\bgmaw\b/i, /\bmig\b(?:\s+weld(?:ing)?)?/i, /\bgas\s+metal(?:\s+arc)?\s+weld/i, /\bmetal\s+inert\s+gas\b/i] },
  { key: "smaw_stick", patterns: [/\bsmaw\b/i, /\bstick\s+weld(?:ing)?\b/i, /\bshielded\s+metal(?:\s+arc)?\s+weld/i] },
  { key: "fcaw", patterns: [/\bfcaw\b/i, /\bflux[\s-]?core(?:d)?\s*(?:arc\s+)?weld(?:ing)?\b/i] },
  { key: "saw_submerged", patterns: [/\bsubmerged\s+arc\s+weld(?:ing)?\b/i] },
  { key: "laser_welding", patterns: [/\blaser\s+weld(?:ing)?\b/i, /\blbw\b/i, /\blaser\s+beam\s+weld(?:ing)?\b/i] },
  { key: "electron_beam_welding", patterns: [/\belectron\s+beam\s+weld(?:ing)?\b/i, /\bebw\b/i] },
  { key: "resistance_welding", patterns: [/\bresistance\s+weld(?:ing)?\b/i, /\bspot\s+weld(?:ing)?\b/i, /\bseam\s+weld(?:ing)?\b/i, /\bprojection\s+weld(?:ing)?\b/i] },
  { key: "plasma_arc_welding", patterns: [/\bpaw\b(?=\s+(?:weld|arc|process))/i, /\bplasma\s+arc\s+weld(?:ing)?\b/i] },
  { key: "thermit_welding", patterns: [/\bthermit\s+weld(?:ing)?\b/i, /\baluminothermic\s+weld(?:ing)?\b/i, /\bcadweld\b/i] },
  { key: "stud_welding", patterns: [/\bstud\s+weld(?:ing)?\b/i] },
  { key: "friction_welding", patterns: [/\bfriction\s+(?:stir\s+)?weld(?:ing)?\b/i, /\bfsw\b/i, /\binertia\s+weld(?:ing)?\b/i] },
  { key: "ultrasonic_welding", patterns: [/\bultrasonic\s+weld(?:ing)?\b/i] },
  { key: "welding_generic", patterns: [/\bweld(?:ing|ed|s|er)?\b/i] },
];

// Secondary execution/application tags — describe HOW a weld is performed, not WHAT process it is
const WELDING_SECONDARY_PATTERNS = [
  { key: "orbital_welding", patterns: [/\borbital\s+(?:weld(?:ing)?|tig|gtaw|lines?|head)\b/i] },
  { key: "sanitary_tube_welding", patterns: [/\bsanitary\s+(?:tube|tubing|weld(?:ing)?|tig)\b/i, /\bhygienic\s+weld(?:ing)?\b/i] },
  { key: "tube_welding_application", patterns: [/\btub(?:e|ing)\b/i, /\bsmall[\s-]?bore\s+(?:tube|pipe)\b/i] },
  { key: "automatic_welding", patterns: [/\bauto(?:matic|mated)\s+weld(?:ing)?\b/i, /\bautogenous\s+(?:orbital\s+)?weld(?:ing)?\b/i, /\bmachine\s+weld(?:ing)?\b/i] },
  { key: "manual_tig_welding", patterns: [/\bmanual\s+(?:tig|gtaw)\b/i, /\bhand\s+(?:tig|gtaw)\b/i] },
  { key: "pulse_mode_welding", patterns: [/\bpulse(?:d)?\s+(?:tig|mig|gtaw|gmaw|arc|weld(?:ing)?)\b/i, /\bpulse\s+mode\b/i] },
  { key: "backpurge_welding", patterns: [/\bback[\s-]?purge\b/i, /\bpurge\b/i] },
  { key: "gas_panel_welding", patterns: [/\bgas\s+panels?\b/i] },
  { key: "position_welding", patterns: [/\b(?:2g|3g|4g|5g|6g)\b/i, /\b(?:flat|horizontal|vertical|overhead|all[\s-]position)\s+(?:weld(?:ing)?|position)\b/i] },
  { key: "hot_pass_welding", patterns: [/\b(?:root|hot|fill|cap)\s+pass\b/i] },
];

// Material and substrate context tags
const WELDING_MATERIAL_PATTERNS = [
  { key: "stainless", patterns: [/\bstainless\s*(?:steel)?\b/i, /\bss\b(?=\s+(?:tube|pipe|weld|plate|sheet|fitting))/i] },
  { key: "carbon_steel", patterns: [/\bcarbon\s+steel\b/i, /\bmild\s+steel\b/i] },
  { key: "aluminum", patterns: [/\balum(?:in(?:um|ium))?\b/i] },
  { key: "titanium", patterns: [/\btitanium\b/i] },
  { key: "inconel", patterns: [/\binconel\b/i, /\bnickel\s+alloy\b/i] },
  { key: "duplex_stainless", patterns: [/\bduplex\s+(?:stainless\s+)?steel\b/i, /\bsuper\s+duplex\b/i] },
  { key: "quarter_inch_tubing", patterns: [/\b(?:1\/4|\.25)["']?\s*(?:tube|tubing|od|pipe)\b/i] },
  { key: "gas_panel", patterns: [/\bgas\s+panels?\b/i] },
  { key: "no2_panel", patterns: [/\bno2\b/i, /\bn2o\b/i, /\bnitrous?\s+(?:oxide\s+)?panel\b/i] },
  { key: "high_purity_gas", patterns: [/\bhigh[\s-]purity\b/i, /\buhp\b/i, /\bultra[\s-]high[\s-]purity\b/i] },
  // Preserve generic object words in welding context rather than dropping them
  { key: "line_connections", patterns: [/\blines?\b/i, /\bline\s+(?:connect(?:ion)?s?|work|run)\b/i] },
];

// Scope bias tags for welding context
const WELDING_SCOPE_BIAS_PATTERNS = [
  { key: "precision", patterns: [/\bprecision\b/i, /\btight\s+toleran/i] },
  { key: "clean_process", patterns: [/\bsanitary\b/i, /\bhygienic\b/i, /\bclean[\s-]room\b/i] },
  { key: "purge_control", patterns: [/\bpurge\b/i] },
  { key: "stainless_detail", patterns: [/\bstainless\b/i, /\bpassivat(?:ion|e)\b/i, /\belectropolish(?:ing)?\b/i] },
  { key: "code_compliance", patterns: [/\basme\b/i, /\baws\s+(?:d1|b2)/i, /\bd1\.[123]\b/i, /\bwps\b/i, /\bpqr\b/i] },
  { key: "x_ray_inspection", patterns: [/\bx[\s-]?ray\b/i, /\bradiograph(?:ic|y)?\b/i, /\bndt\b/i] },
  { key: "install_oriented", patterns: [/\binstall\b/i, /\brun(?:ning)?\s+(?:line|tube|pipe)\b/i] },
  { key: "configure", patterns: [/\bconfig(?:ure|uration)?\b/i] },
];

// Welding intent: any welding terminology present in raw text
const WELDING_INTENT_REGEX = /\bweld(?:ing|ed|s|er)?\b|\bgtaw\b|\bgmaw\b|\bsmaw\b|\bfcaw\b|\btig\b|\bmig\b|\bcadweld\b|\bebw\b|\bfsw\b|\blbw\b|\borbital\s+(?:weld(?:ing)?|tig|gtaw|lines?|head)\b/i;

// Ironwork taxonomy normalization constants (Pass 15)
// Gate: distinctive ironwork terms — must fire before family/operation detection runs
const IRONWORK_INTENT_REGEX = /\brebar\b|\bjoists?\b|\bgirders?\b|\bpurlins?\b|\bgirts?\b|\bpemb\b|\bironwork\b|\bornamental\s+iron\b|\bcustom\s+iron\b|\biron\s+(?:picket|railing?|gate|fence)\b|\bstructural\s+steel\b|\bstructural\s+(?:columns?|beams?|braces?|frames?)\b|\bmetal\s+deck(?:ing)?\b|\broof\s+deck\b|\bfloor\s+deck\b|\bprecast\b|\bcatwalk\b|\bdunnage\b|\blintel\b|\bshelf\s+angle\b|\bbolt\s+up\b|\bguardrails?\b|\bshear\s+studs?\b|\bpour\s+stop\b|\bbase\s+plates?\b|\banchor\s+rods?\b|\bstair\s+(?:pans?|rails?|stringers?)\b|\bclip\s+angle\b|\bsplice\s+plates?\b|\bsteel\s+(?:beams?|columns?|frames?|braces?|erect|stairs?|support)\b|\berect\s+(?:steel|beams?|columns?|joists?)\b|\bcrane\s+(?:pick|lift|set)\b|\brig(?:ging)?\s+(?:and|steel|beam|joist|girder|crane)\b|\bfield\s+weld\b|\bfield\s+bolt\b|\bcanopy\s+frame\b|\bsupport\s+frame\b|\bsupport\s+steel\b|\bembeds?\s+plate\b|\bembeds?\b|\bbollards?\b|\bmisc(?:ellaneous)?\s+metal\b|\bdiaphragm\b|\bcross\s+frame\b|\bretrofit\b|\badd\s+plate\b|\bshim\b|\bcope\b|\breinforc(?:ing)?\s+(?:steel|bars?|mat|mesh)\b|\bepoxy\s+bar\b|\bedge\s+angle\b|\bdowels?\b|\bfixed\s+ladder\b|\bmetal\s+platform\b|\bsecurity\s+fence\b|\bslide\s+gate\b|\bswing\s+gate\b|\btank\s+shell\b|\bshell\s+plate\b|\broof\s+ring\b|\bstiffeners?\b|\bframed\s+opening\b|\bangle\s+iron\b|\bsteel\s+support\b|\blay\s+deck\b|\bbridge\s+(?:steel|splice|girder)\b|\bfield\s+splice\b/i;

// Trade family registry — most specific first; miscellaneous_metals is catch-all fallback
const IRONWORK_TRADE_FAMILY_PATTERNS = [
  {
    key: "reinforcing_rebar",
    patterns: [/\brebar\b/i, /\brod\s+bust(?:ing|er)?\b/i, /\btie\s+(?:rebar|bars?|rods?)\b/i, /\bplace\s+(?:rebar|bars?|reinforcing)\b/i, /\breinforc(?:ing|e)\s+(?:steel|bars?|mesh|mat)\b/i, /\b(?:rebar|reinforcing)\s+(?:cage|mat|mesh)\b/i, /\bepoxy\s+(?:bars?|dowels?)\b/i, /\bdowel\s+bars?\b/i],
  },
  {
    key: "bridge_ironwork",
    patterns: [/\bbridge\s+(?:steel|iron|girder|erect|splice)\b/i, /\bgirder\s+(?:set|splice)\b/i, /\bdiaphragm\b/i, /\bcross\s+frame\b/i, /\bfield\s+splice\b/i, /\bbridge\s+bear(?:ing)?\b/i],
  },
  {
    key: "pre_engineered_metal_building",
    patterns: [/\bpemb\b/i, /\bmetal\s+build(?:ing)?\b/i, /\bpre[\s-]engineer(?:ed)?\s+build(?:ing)?\b/i, /\brigid\s+frame\b/i, /\bpurlins?\b/i, /\bgirts?\b/i, /\bframed\s+opening\b/i],
  },
  {
    key: "precast_panel_connection",
    patterns: [/\bprecast\b/i, /\btilt\s+panel\b/i, /\bpanel\s+(?:connect|erect|set)\b/i, /\bpanel\s+connection\s+plate\b/i, /\berect(?:ion)?\s+hardware\b/i, /\bbrace\s+frame\s+(?:for|at|panel)\b/i],
  },
  {
    key: "tank_and_specialty_erection",
    patterns: [/\btank\s+(?:shell|erect|ring)\b/i, /\bshell\s+plate\b/i, /\broof\s+ring\b/i, /\bshell\s+seam\b/i, /\btank\s+stiffener\b/i],
  },
  {
    key: "metal_decking",
    patterns: [/\bmetal\s+deck(?:ing)?\b/i, /\broof\s+deck\b/i, /\bfloor\s+deck\b/i, /\bdeck\s+sheets?\b/i, /\blay\s+deck\b/i, /\bfasten\s+deck\b/i, /\bshear\s+studs?\b/i, /\bpour\s+stop\b/i, /\bedge\s+angle\b/i],
  },
  {
    key: "ornamental_ironwork",
    patterns: [/\bornamental\s+(?:iron|rail|fence|gate|metal)\b/i, /\bdecorative\s+(?:iron|metal|railing?)\b/i, /\bcustom\s+iron\b/i, /\bscroll\s+(?:work|iron)\b/i, /\biron\s+(?:picket|railing?|gate|fence)\b/i],
  },
  {
    key: "stairs_and_rails",
    patterns: [/\bstair\s+(?:pans?|rails?|railing?|sections?|tread|landing|stringer)\b/i, /\bguardrails?\b/i, /\bsteel\s+stairs?\b/i, /\bhandrail\b/i],
  },
  {
    key: "fencing_and_gates",
    patterns: [/\bswing\s+gate\b/i, /\bslide\s+gate\b/i, /\bsecurity\s+fence\b/i, /\blatch\s+post\b/i, /\bfence\s+(?:panel|post|section|gate)\b/i, /\bpicket\s+fence\b/i],
  },
  {
    key: "ladders_platforms_access",
    patterns: [/\bcage\s+ladder\b/i, /\baccess\s+ladder\b/i, /\bfixed\s+ladder\b/i, /\bcatwalk\b/i, /\bcrossover\s+(?:platform|landing)\b/i, /\baccess\s+platform\b/i, /\bladders?\b/i, /\bplatforms?\b/i],
  },
  {
    key: "retrofit_rehab_modification",
    patterns: [/\bretrofit\b/i, /\bmodify\s+(?:steel|metal|frame|platform)\b/i, /\brehab\s+(?:steel|frame|structure)\b/i, /\badd\s+plate\b/i, /\bstrengthen\b/i, /\breplace\s+(?:damaged|bent)\s+(?:steel\s+)?(?:member|section|beam|column)\b/i, /\breinforce\b(?!(?:ing|ment)\b)/i],
  },
  {
    key: "supports_frames_canopies",
    patterns: [/\bdunnage\b/i, /\bcanopy\s+frame\b/i, /\bequipment\s+support\b/i, /\bsupport\s+frame\b/i, /\bsteel\s+support\b/i, /\bsupport\s+steel\b/i, /\bcurb\s+frame\b/i, /\bangle\s+support\b/i],
  },
  {
    key: "structural_steel_erection",
    patterns: [/\bstructural\s+steel\b/i, /\berect\s+(?:steel|beams?|columns?|joists?|frame|structure)\b/i, /\braise\s+(?:steel|beams?|columns?|joists?)\b/i, /\bsteel\s+(?:beams?|columns?|braces?|joists?|girders?|frame)\b/i, /\bbeams?\s+(?:and\s+column|set|erect)\b/i, /\bcolumns?\s+(?:and\s+beam|plumb|set|erect)\b/i, /\bsteel\s+erect(?:ion)?\b/i, /\brig(?:ging)?\s+steel\b/i, /\bfield\s+weld\b/i, /\bbeams?\b/i, /\bcolumns?\b/i, /\bjoists?\b/i],
  },
  {
    key: "miscellaneous_metals",
    patterns: [/\bmisc(?:ellaneous)?\s+metal\b/i, /\bbollards?\b/i, /\blintels?\b/i, /\bshelf\s+angle\b/i, /\bembed(?:ded)?\s+(?:plate|anchor)\b/i, /\bangle\s+iron\b/i, /\bbase\s+plates?\b/i, /\banchor\s+rods?\b/i, /\bclip\s+angles?\b/i],
  },
];

// Operation tags — what is being done to the ironwork
const IRONWORK_OPERATION_PATTERNS = [
  { key: "erection_placement", patterns: [/\berect\b/i, /\braise\s+(?:steel|beams?|columns?|joists?|frame)\b/i, /\bfly\s+(?:steel|beams?|joists?|girders?|panel)\b/i, /\bset\s+(?:steel|beams?|columns?|joists?|girders?|panel|frame)\b/i, /\bplace\s+(?:steel|beams?|columns?|joists?|rebar|bars?)\b/i] },
  { key: "bolt_up_connections", patterns: [/\bbolt\s+up\b/i, /\bbolting\b/i, /\bsnug\s+tight\b/i, /\bsplice\s+plates?\b/i, /\btorque\s+(?:bolt|wrench)\b/i, /\bfield\s+bolt\b/i, /\bstructural\s+bolt\b/i, /\bconnect\s+steel\b/i, /\bbridge\s+splice\b/i, /\bgirder\s+splice\b/i, /\bfield\s+splice\b/i] },
  { key: "field_weld_connections", patterns: [/\bfield\s+weld\b/i, /\bweld\s+(?:clip|plate|connection|angle|support|attach)\b/i, /\bstitch\s+weld\b/i, /\bweld\s+out\b/i, /\battach\s+by\s+weld\b/i] },
  { key: "rigging_hoisting_signaling", patterns: [/\brig(?:ging)?\b/i, /\bhoist\b/i, /\bcrane\s+pick\b/i, /\bsignal\s+crane\b/i, /\btag\s+line\b/i, /\bslings?\b/i, /\bchokers?\b/i, /\bspreader\s+bar\b/i, /\bpick\s+and\s+set\b/i] },
  { key: "layout_alignment", patterns: [/\bplumb\b/i, /\balign\b/i, /\bsquare\s+(?:up|frame|steel)\b/i, /\bshim\b/i, /\btrue\s+up\b/i, /\blayout\b/i] },
  { key: "lay_place_decking", patterns: [/\blay\s+deck\b/i, /\bplace\s+deck(?:ing)?\b/i, /\binstall\s+deck(?:ing)?\b/i, /\bfasten\s+deck(?:ing)?\b/i] },
  { key: "shop_fabrication", patterns: [/\bfabricat(?:e|ion)\b/i, /\bcope\b/i, /\bdrill\s+(?:steel|holes?|bolt)\b/i, /\bpunch\s+(?:steel|holes?|bolt)\b/i, /\blay\s+out\b/i, /\btemplate\b/i, /\bfit\s+(?:steel|up|out)\b/i, /\bshop\s+(?:build|fab|weld)\b/i] },
  { key: "reinforcing_operation", patterns: [/\btie\s+(?:rebar|bars?|rods?|cage|mat)\b/i, /\bplace\s+rebar\b/i, /\bcage\s+up\b/i, /\bmat\s+down\b/i, /\bdowel\s+in\b/i, /\bplace\s+(?:bars?|reinforcing)\b/i] },
  { key: "repair_retrofit_op", patterns: [/\bretrofit\b/i, /\brepair\b/i, /\bmodify\b/i, /\bstrengthen\b/i, /\badd\s+plate\b/i, /\brehab\b/i] },
];

// Assembly and object tags
const IRONWORK_OBJECT_PATTERNS = [
  { key: "beam", patterns: [/\bbeams?\b/i] },
  { key: "column", patterns: [/\bcolumns?\b/i] },
  { key: "girder", patterns: [/\bgirders?\b/i] },
  { key: "joist", patterns: [/\bjoists?\b/i] },
  { key: "brace", patterns: [/\bbraces?\b/i] },
  { key: "rebar", patterns: [/\brebar\b/i, /\breinforc(?:ing)?\s+(?:steel|bars?)\b/i] },
  { key: "cage", patterns: [/\bcages?\b/i] },
  { key: "mat", patterns: [/\bmats?\b/i] },
  { key: "mesh", patterns: [/\bmesh\b/i] },
  { key: "rail", patterns: [/\brails?\b/i, /\brailings?\b/i] },
  { key: "handrail", patterns: [/\bhandrails?\b/i] },
  { key: "guardrail", patterns: [/\bguardrails?\b/i] },
  { key: "fence", patterns: [/\bfences?\b/i] },
  { key: "gate", patterns: [/\bgates?\b/i] },
  { key: "ladder", patterns: [/\bladders?\b/i] },
  { key: "platform", patterns: [/\bplatforms?\b/i] },
  { key: "catwalk", patterns: [/\bcatwalks?\b/i] },
  { key: "canopy", patterns: [/\bcanop(?:y|ies)\b/i] },
  { key: "deck", patterns: [/\bdecking\b/i, /\b(?:roof|floor|metal)\s+deck\b/i, /\bdeck\b/i] },
  { key: "pour_stop", patterns: [/\bpour\s+stop\b/i] },
  { key: "edge_angle", patterns: [/\bedge\s+angle\b/i] },
  { key: "lintel", patterns: [/\blintels?\b/i] },
  { key: "shelf_angle", patterns: [/\bshelf\s+angle\b/i] },
  { key: "embed", patterns: [/\bembeds?\b/i, /\bembedded\s+plates?\b/i] },
  { key: "base_plate", patterns: [/\bbase\s+plates?\b/i] },
  { key: "anchor_rod", patterns: [/\banchor\s+rods?\b/i] },
  { key: "stair", patterns: [/\bstairs?\b/i, /\bstair\s+(?:pans?|rails?|sections?|tread|stringer)\b/i] },
  { key: "purlin", patterns: [/\bpurlins?\b/i] },
  { key: "girt", patterns: [/\bgirts?\b/i] },
  { key: "support_frame", patterns: [/\bsupport\s+frame\b/i, /\bdunnage\b/i] },
  { key: "bollard", patterns: [/\bbollards?\b/i] },
  { key: "clip_angle", patterns: [/\bclip\s+angles?\b/i] },
  { key: "splice_plate", patterns: [/\bsplice\s+plates?\b/i] },
  { key: "shear_stud", patterns: [/\bshear\s+studs?\b/i] },
  { key: "stiffener", patterns: [/\bstiffeners?\b/i] },
];

// Scope bias tags for ironwork context
const IRONWORK_SCOPE_BIAS_PATTERNS = [
  { key: "structural_frame", patterns: [/\bstructural\b/i, /\bsteel\s+frame\b/i] },
  { key: "connection_heavy", patterns: [/\bbolt\s+up\b/i, /\bsplice\b/i, /\bfield\s+bolt\b/i] },
  { key: "erection_oriented", patterns: [/\berect\b/i, /\braise\b/i, /\bfly\b/i] },
  { key: "ornamental_finish", patterns: [/\bornamental\b/i, /\bdecorative\b/i, /\bcustom\s+(?:iron|metal)\b/i] },
  { key: "rebar_install", patterns: [/\brebar\b/i, /\btie\s+(?:bars?|rebar|cage|mat)\b/i] },
  { key: "layout_precision", patterns: [/\bplumb\b/i, /\balign\b/i, /\bsquare\b/i, /\bshim\b/i, /\btrue\s+up\b/i] },
  { key: "rigging_heavy", patterns: [/\brig(?:ging)?\b/i, /\bhoist\b/i, /\bcrane\b/i] },
  { key: "decking_install", patterns: [/\bdeck(?:ing)?\b/i, /\bshear\s+stud\b/i, /\bpour\s+stop\b/i] },
  { key: "access_system", patterns: [/\bladder\b/i, /\bplatform\b/i, /\bcatwalk\b/i] },
  { key: "support_steel", patterns: [/\bdunnage\b/i, /\bsupport\s+(?:frame|steel)\b/i, /\bequipment\s+support\b/i] },
  { key: "bridge_heavy", patterns: [/\bbridge\b/i, /\bgirder\s+(?:set|splice)\b/i, /\bdiaphragm\b/i] },
  { key: "canopy_context", patterns: [/\bcanopy\b/i] },
  { key: "retrofit_repair", patterns: [/\bretrofit\b/i, /\brehab\b/i, /\bmodify\b/i, /\badd\s+plate\b/i] },
];

// Carpentry taxonomy normalization constants (Pass 17)
// Gate: distinctive compound carpentry terms — prevents generic single words from firing
const CARPENTRY_INTENT_REGEX = /\bprehung\b|\brough\s+fram(?:e|ing)\b|\bframe\s+(?:soffit|opening|wall|chase|out)\b|\bset\s+forms?\b|\bstrip\s+forms?\b|\bpatch\s+subfloor\b|\bsubfloor\s+(?:patch|repair|replace|install)\b|\bstair\s+(?:tread|riser|nosing|repair|landing|stringer)\b|\bstringer\b|\btrim\s+casing\b|\bcrown\s+mold(?:ing)?\b|\bchair\s+rail\b|\bshoe\s+mold(?:ing)?\b|\bcasework\b|\bmillwork\b|\bbuilt[\s-]?in\b|\bwall\s+sheathing\b|\broof\s+sheathing\b|\bfloor\s+sheathing\b|\binstall\s+(?:uppers?|lowers?|cabinets?|casework|millwork|subfloor|underlayment|sheathing|baseboard|crown|casing|stringer)\b|\bbaseboard\s+(?:install|replace|trim)\b|\bsoffit\s+(?:board|panel|trim)\b|\bfascia\s+board\b/i;

// Trade family registry — most specific first; general_carpentry is catch-all
const CARPENTRY_TRADE_FAMILY_PATTERNS = [
  {
    key: "door_installation",
    patterns: [/\bprehung\b/i, /\bhang\s+(?:the\s+)?(?:prehung\s+)?door\b/i, /\bdoor\s+(?:install|hang|unit|set)\b/i, /\bjamb\s+(?:set|install)\b/i],
  },
  {
    key: "formwork_concrete",
    patterns: [/\bset\s+forms?\b/i, /\bstrip\s+forms?\b/i, /\bformwork\b/i, /\bshoring\b/i],
  },
  {
    key: "stair_work",
    patterns: [/\bstair\s+(?:tread|riser|nosing|repair|landing|stringer)\b/i, /\bstringer\b/i, /\btread\s+(?:install|replace|repair)\b/i],
  },
  {
    key: "sheathing_subfloor",
    patterns: [/\bwall\s+sheathing\b/i, /\broof\s+sheathing\b/i, /\bfloor\s+sheathing\b/i, /\bpatch\s+subfloor\b/i, /\bsubfloor\s+(?:patch|repair|replace|install)\b/i, /\binstall\s+(?:subfloor|underlayment|sheathing)\b/i, /\bplywood\s+(?:floor|deck|subfloor)\b/i, /\bosb\s+(?:floor|deck|subfloor)\b/i],
  },
  {
    key: "rough_framing",
    patterns: [/\brough\s+fram(?:e|ing)\b/i, /\bframe\s+(?:soffit|opening|wall|chase|out)\b/i],
  },
  {
    key: "trim_molding",
    patterns: [/\btrim\s+casing\b/i, /\bcrown\s+mold(?:ing)?\b/i, /\bchair\s+rail\b/i, /\bshoe\s+mold(?:ing)?\b/i, /\bbaseboard\s+(?:install|replace|trim)\b/i, /\binstall\s+(?:baseboard|casing|crown)\b/i, /\bsoffit\s+(?:board|panel|trim)\b/i, /\bfascia\s+board\b/i],
  },
  {
    key: "finish_carpentry_casework",
    patterns: [/\bcasework\b/i, /\bmillwork\b/i, /\bbuilt[\s-]?in\b/i, /\binstall\s+(?:uppers?|lowers?|cabinets?|casework|millwork|shelving)\b/i],
  },
  {
    key: "general_carpentry",
    patterns: [],
  },
];

// Operation tags — what carpentry operation is being performed
const CARPENTRY_OPERATION_PATTERNS = [
  { key: "hang_install", patterns: [/\bhang\b/i, /\binstall\b/i, /\bset\b/i] },
  { key: "frame_out", patterns: [/\bframe\s+(?:out|soffit|wall|opening|up)\b/i, /\brough\s+fram(?:e|ing)\b/i] },
  { key: "trim_finish", patterns: [/\btrim\s+(?:out|casing)\b/i, /\bfinish\s+(?:out|trim)\b/i, /\bcasing\b/i] },
  { key: "patch_repair", patterns: [/\bpatch\b/i, /\brepair\b/i] },
  { key: "strip_form", patterns: [/\bstrip\s+forms?\b/i] },
  { key: "set_form", patterns: [/\bset\s+forms?\b/i] },
  { key: "shim_align", patterns: [/\bshim\b/i, /\balign\b/i, /\bplumb\b/i, /\blevel\b/i] },
  { key: "replace_changeout", patterns: [/\breplace\b/i] },
];

// Object/assembly tags for carpentry
const CARPENTRY_OBJECT_PATTERNS = [
  { key: "prehung_door", patterns: [/\bprehung\b/i] },
  { key: "door", patterns: [/\bdoors?\b/i] },
  { key: "jamb", patterns: [/\bjambs?\b/i] },
  { key: "upper_cabinet", patterns: [/\buppers?\b/i, /\bupper\s+cabinets?\b/i, /\bwall\s+cabinets?\b/i] },
  { key: "lower_cabinet", patterns: [/\blowers?\b/i, /\bbase\s+cabinets?\b/i] },
  { key: "cabinet", patterns: [/\bcabinets?\b/i, /\bcasework\b/i] },
  { key: "stair_tread", patterns: [/\bstair\s+tread\b/i, /\btreads?\b/i] },
  { key: "stair_riser", patterns: [/\brisers?\b/i] },
  { key: "stringer", patterns: [/\bstringers?\b/i] },
  { key: "baseboard", patterns: [/\bbaseboards?\b/i] },
  { key: "crown_molding", patterns: [/\bcrown\s+mold(?:ing)?\b/i] },
  { key: "casing", patterns: [/\bcasings?\b/i] },
  { key: "chair_rail", patterns: [/\bchair\s+rail\b/i] },
  { key: "subfloor", patterns: [/\bsubfloor\b/i, /\bunderlayment\b/i] },
  { key: "sheathing", patterns: [/\bsheathing\b/i, /\bplywood\b/i, /\bosb\b/i] },
  { key: "form", patterns: [/\bforms?\b/i] },
  { key: "soffit", patterns: [/\bsoffit\b/i] },
  { key: "fascia", patterns: [/\bfascia\b/i] },
  { key: "millwork", patterns: [/\bmillwork\b/i, /\bbuilt[\s-]?in\b/i] },
  { key: "stud", patterns: [/\bstuds?\b/i] },
  { key: "blocking", patterns: [/\bblocking\b/i] },
  { key: "header", patterns: [/\bheaders?\b/i] },
];

// Scope bias tags for carpentry context
const CARPENTRY_SCOPE_BIAS_PATTERNS = [
  { key: "finish_quality", patterns: [/\bfinish\b/i, /\btrim\b/i, /\bmold(?:ing)?\b/i, /\bcasing\b/i] },
  { key: "rough_work", patterns: [/\brough\b/i, /\bframing\b/i, /\bblocking\b/i] },
  { key: "precision_fit", patterns: [/\bprehung\b/i, /\bshim\b/i, /\bplumb\b/i, /\blevel\b/i] },
  { key: "concrete_form", patterns: [/\bforms?\b/i, /\bstrip\b/i, /\bshoring\b/i] },
  { key: "repair_patch", patterns: [/\bpatch\b/i, /\brepair\b/i] },
  { key: "structural_carpentry", patterns: [/\bsheathing\b/i, /\bheader\b/i, /\bframe\b/i] },
];

const COMMERCIAL_CONTEXT_PATTERNS = [
  { label: "commercial kitchen", regex: /\bcommercial kitchen\b/i },
  { label: "kitchen", regex: /\bkitchen\b/i },
  { label: "laundry", regex: /\blaundry(?:\s+room)?\b/i },
  { label: "lobby", regex: /\blobby\b/i },
  { label: "restroom", regex: /\brestroom\b|\bbath(?:room)?\b/i },
  { label: "storefront", regex: /\bstorefront\b/i },
  { label: "hotel", regex: /\bhotel\b/i },
  { label: "warehouse", regex: /\bwarehouse\b/i },
  { label: "office", regex: /\boffice\b/i },
  { label: "storage room", regex: /\bstorage room\b/i },
  { label: "breakroom", regex: /\bbreakroom\b/i },
  { label: "waiting area", regex: /\bwaiting area\b/i },
  { label: "reception", regex: /\breception\b/i },
  { label: "tenant improvement", regex: /\btenant improvement\b|\bti\b/i },
  { label: "commercial", regex: /\bcommercial\b/i },
];

const CONNECTED_ASSET_CATEGORIES = new Set([
  "plumbing_fixture",
  "plumbing_equipment",
  "mechanical_equipment",
  "electrical_equipment",
]);

const ASSET_FAMILY_BY_CATEGORY = {
  interior_builtin: "interior_builtin_casework",
  plumbing_fixture: "connected_equipment_fixture",
  plumbing_equipment: "connected_equipment_fixture",
  mechanical_equipment: "connected_equipment_fixture",
  electrical_equipment: "connected_equipment_fixture",
  general_equipment: "connected_equipment_fixture",
  door_hardware: "non_connected_hardware_asset",
  site_hardware: "site_exterior_asset",
  glazing_storefront: "storefront_glazing_opening",
  finish_surface: "finish_material_surface",
  repair_surface: "repair_surface_damage",
};

const EXPANSION_WORK_BUCKETS = new Set([
  "demo_remove",
  "replace_connected_equipment",
  "replace_non_connected_asset",
  "install_new_asset",
  "repair_patch",
  "finish_coating",
]);

const TECHNICAL_SCOPE_PATTERNS = [
  { label: "orbital welding", regex: /\borbital weld(?:ing)?\b/i },
  { label: "welding", regex: /\bweld(?:ed|ing)?\b/i },
  { label: "stainless steel", regex: /\bstainless\b/i },
  { label: "instrumentation", regex: /\binstrument(?:ation)?\b/i },
  { label: "controls", regex: /\bcontrols?\b/i },
  { label: "panel work", regex: /\b(?:electrical|distribution|control|breaker|switchgear|existing|new)\s+panels?\b|\bpanelboards?\b|\bpanels?\s+(?:board|boards|gear|enclosure|enclosures)\b/i },
  { label: "tie-in", regex: /\btie(?:-| )?in(?:s)?\b/i },
  { label: "circuit breaker work", regex: /\bcircuit breakers?\b|\bbreakers?\b/i },
  { label: "disconnect work", regex: /\bdisconnect(?:s)?\b/i },
  { label: "conduit work", regex: /\bconduit\b|\bemt\b|\bimc\b|\brigid\b|\braceway\b/i },
  { label: "process tubing", regex: /\bprocess tubing\b|\btubing\b/i },
  { label: "fractional sizing", regex: /\b\d+\/\d+\b/ },
  { label: "line footage", regex: /\b\d+(?:\.\d+)?\s*(?:feet|foot|ft)\b/i },
  { label: "process lines", regex: /\bprocess lines?\b|\binstrument(?:ation)? lines?\b|\btubing\b|\btube\b|\bpiping\b/i },
  { label: "rooftop equipment", regex: /\brooftop\b|\bpackage unit\b|\brtu\b/i },
  { label: "tenant improvement", regex: /\btenant improvement\b|\bti\b/i },
  { label: "site lighting equipment", regex: SITE_LIGHTING_ASSET_REGEX },
  { label: "site asset work", regex: SITE_ASSET_REGEX },
  { label: "sub-fab environment", regex: /\bsub[ -]?fab\b/i },
  { label: "fab environment", regex: /\bfab\b/i },
  { label: "cleanroom environment", regex: /\bcleanroom\b/i },
  { label: "industrial site", regex: /\bintel\b|\bplant\b|\bfacility\b/i },
  { label: "qa/qc requirements", regex: /\bqa\b|\bqc\b|\binspection\b|\btest(?:ing)?\b/i },
];

const ELECTRICAL_COMMERCIAL_TECHNICAL_SIGNALS = new Set([
  "circuit breaker work",
  "disconnect work",
  "conduit work",
  "rooftop equipment",
  "tenant improvement",
  "panel work",
]);

const FINISH_CARPENTRY_PATTERNS = [
  { label: "baseboards", regex: /\bbaseboards?\b/i },
  { label: "trim", regex: /\btrim\b|\bfinish trim\b|\bfascia\b|\bsoffit trim\b|\bcap\b/i },
  { label: "casing", regex: /\bcasing\b|\bdoor trim\b/i },
  { label: "crown molding", regex: /\bcrown(?:\s+mold(?:ing)?)?\b/i },
  { label: "shoe molding", regex: /\bshoe\s*mold(?:ing)?\b/i },
  { label: "casework", regex: /\blower cabinet runs?\b|\bcabinet runs?\b|\bcabinet sections?\b|\bcabinet doors?\b|\bwall cabinets?\b|\bbase cabinets?\b|\buppers?\b|\blowers?\b|\bcabinets?\b|\bshelves\b|\bshelf\b|\bshelving\b|\bcasework\b|\bmillwork\b|\bbuilt[-\s]?ins?\b|\blocker units?\b|\bbuilt[-\s]?in benches?\b|\bbenches?\b|\bstorage units?\b/i },
];

const EXCLUSION_PATTERNS = [
  /\b(?:exclude|excluding)\s+([^.\n;]+)/gi,
  /\b(?:does not include|do not include|not included)\s+([^.\n;]+)/gi,
];

const GENERIC_SCOPE_SUMMARY_PREFIX_REGEX = /^(?:scope|work|this project)\s+includes?\b/i;
const GENERIC_COOKIE_CUTTER_EXCLUSION_REGEX = /\bconcealed damage\b|\bhidden damage\b|\bsurface repair\b|\badjacent areas\b|\bagreed work area\b/i;

const SAFE_WORDING_SIGNAL_PATTERNS = [
  { label: "as needed", regex: /\bas needed\b/i },
  { label: "if needed", regex: /\bif needed\b/i },
  { label: "if required", regex: /\bif required\b/i },
  { label: "as required", regex: /\bas required\b/i },
  { label: "where required", regex: /\bwhere required\b/i },
  { label: "where needed", regex: /\bwhere needed\b/i },
  { label: "hidden damage", regex: /\bhidden damage\b/i },
  { label: "concealed damage", regex: /\bconcealed damage\b/i },
  { label: "unknown conditions", regex: /\bunknown conditions?\b/i },
  { label: "existing conditions", regex: /\bexisting conditions?\b/i },
  { label: "concealed conditions", regex: /\bconcealed conditions?\b/i },
  { label: "limited access", regex: /\blimited access\b|\baccess limitations?\b/i },
  { label: "repair around access", regex: /\b(?:patch|repair|demo)\b.*\baround\b.*\baccess\b/i },
];

const RISK_TRIGGER_PATTERNS = [
  { label: "as needed", regex: /\bas needed\b/i },
  { label: "if needed", regex: /\bif needed\b/i },
  { label: "if required", regex: /\bif required\b/i },
  { label: "patch", regex: /\bpatch(?:es|ed|ing)?\b/i },
  { label: "repair", regex: /\brepair(?:s|ed|ing)?\b/i },
  { label: "damaged", regex: /\bdamaged\b/i },
  { label: "access", regex: /\baccess\b/i },
  { label: "plumbing access", regex: /\bplumbing access\b/i },
  { label: "hidden damage", regex: /\bhidden damage\b/i },
  { label: "concealed damage", regex: /\bconcealed damage\b/i },
  { label: "unknown conditions", regex: /\bunknown conditions?\b/i },
  { label: "existing conditions", regex: /\bexisting conditions?\b/i },
];

const ECHO_STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "for",
  "of",
  "to",
  "in",
  "at",
  "with",
  "this",
  "that",
  "it",
  "notes",
  "scope",
  "points",
  "areas",
  "area",
]);

function asText(value) {
  return String(value ?? "");
}

function uniqueList(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => asText(value).trim())
    .filter((value) => {
      if (!value) return false;
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function unwrapQuotedScopeText(text) {
  const trimmed = asText(text).trim();
  if (!trimmed) return "";
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner) return inner;
  }
  return trimmed;
}

function stripCodeFences(text) {
  let next = asText(text).replace(/\r\n?/g, "\n").trim();
  while (/^```/.test(next) && /```$/.test(next)) {
    next = next
      .replace(/^```[a-z0-9_-]*\s*\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim();
  }
  return next;
}

function stripRedundantScopeLabel(text) {
  const normalized = asText(text).trim();
  if (!normalized) return "";

  const lines = normalized.split("\n");
  const firstLine = lines[0].trim();
  const firstLineSansMarkdown = firstLine
    .replace(/^#+\s*/, "")
    .replace(/^\*\*(.+)\*\*$/u, "$1")
    .trim();

  if (/^(?:scope(?:\s+notes?)?|scope of work|notes?)\s*$/i.test(firstLineSansMarkdown) && lines.length > 1) {
    return lines.slice(1).join("\n").trim();
  }

  return normalized.replace(
    /^(?:#+\s*)?(?:scope(?:\s+notes?)?|scope of work|notes?)\s*:\s*/i,
    ""
  ).trim();
}

function stripScopeAssistLeadIn(text) {
  return asText(text)
    .replace(/^(?:here(?:'s| is)\s+)?(?:the\s+)?(?:revised|updated|refined)\s+(?:version|draft|scope(?:\s+notes?)?)\s*:\s*/i, "")
    .replace(/^(?:revised|updated|refined)\s+(?:version|draft|scope(?:\s+notes?)?)\s*:\s*/i, "")
    .replace(/^(?:here(?:'s| is)\s+)?(?:your\s+)?revised\s+version\s*:\s*/i, "")
    .trim();
}

function restoreEscapedLineBreaks(text) {
  const normalized = asText(text);
  if (!normalized.includes("\\n") || normalized.includes("\n")) return normalized;
  return normalized.replace(/\\n/g, "\n");
}

function normalizeInstructionSpacing(text) {
  return asText(text)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectFormattingIntent(text) {
  const normalized = normalizeInstructionSpacing(text).toLowerCase();
  if (!normalized) return "";
  if (/\bbullet(?:\s*points?)?\b|\bbullets?\b|\bbulleted\b/.test(normalized)) return "bullets";
  if (/\bnumber(?:ed)?\s+(?:list|lines?|points?)\b|\bnumbered\b/.test(normalized)) return "numbered_list";
  if (/\bparagraph\b|\bparagraph form\b|\bprose\b/.test(normalized)) return "paragraph";
  if (/\b(?:one|single)\s+sentence\b|\bsentence only\b|\bas a sentence\b|\binto a sentence\b/.test(normalized)) return "sentence";
  return "";
}

function detectRewriteIntents(text) {
  const normalized = normalizeInstructionSpacing(text);
  const intents = [];
  Object.entries(REWRITE_INTENT_PATTERNS).forEach(([key, regex]) => {
    if (regex.test(normalized)) intents.push(key);
  });
  return intents;
}

function detectBrevityIntent(text) {
  const normalized = normalizeInstructionSpacing(text);
  if (!normalized) return "";
  if (BREVITY_INTENT_PATTERNS.concise.test(normalized)) return "concise";
  if (BREVITY_INTENT_PATTERNS.expand_slightly.test(normalized)) return "expand_slightly";
  return "";
}

function detectSafeWordingRequested(text) {
  return SAFE_WORDING_REQUEST_REGEX.test(normalizeInstructionSpacing(text));
}

function detectExpandRequested(text) {
  return EXPAND_REQUEST_REGEX.test(normalizeInstructionSpacing(text));
}

function collectPatternLabels(patterns, text) {
  const normalized = normalizeInstructionSpacing(text);
  return uniqueList(
    (Array.isArray(patterns) ? patterns : [])
      .filter((entry) => entry?.regex?.test(normalized))
      .map((entry) => entry.label)
  );
}

function extractTechnicalSignals(text) {
  return collectPatternLabels(TECHNICAL_SCOPE_PATTERNS, text);
}

function countInputSentences(text) {
  const matches = normalizeInstructionSpacing(text).match(/[.!?](?:\s|$)/g);
  return matches ? matches.length : 0;
}

function estimateScopeClauseCount({ coreScopeText = "", actions = [], actionItemPhrases = [] } = {}) {
  const normalized = normalizeInstructionSpacing(coreScopeText);
  if (!normalized) return 0;

  const clauseCountFromPunctuation = normalized
    .split(/[.!?;]+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .reduce((count, segment) => {
      const commaParts = segment.split(/\s*,\s*/).map((part) => part.trim()).filter(Boolean).length;
      return count + Math.max(1, commaParts);
    }, 0);

  let clauseCount = clauseCountFromPunctuation || 1;
  if (Array.isArray(actionItemPhrases) && actionItemPhrases.length) {
    clauseCount = Math.max(clauseCount, actionItemPhrases.length);
  } else if (Array.isArray(actions) && actions.length > 1) {
    clauseCount = Math.max(clauseCount, Math.min(actions.length, 3));
  }

  return clauseCount;
}

function countSupportingDetailSignals({
  coreScopeText = "",
  actions = [],
  quantities = [],
  quantityItemPairs = [],
  locations = [],
  uncertaintyPhrases = [],
  technicalSignals = [],
} = {}) {
  const supportingSignals = uniqueList([
    ...(Array.isArray(quantities) ? quantities : []),
    ...(Array.isArray(quantityItemPairs) ? quantityItemPairs : []),
    ...(Array.isArray(locations) ? locations : []),
    ...(Array.isArray(uncertaintyPhrases) ? uncertaintyPhrases : []),
    ...(Array.isArray(actions) && actions.length > 1 ? actions.slice(1) : []),
    ...(Array.isArray(technicalSignals) && technicalSignals.length > 1 ? technicalSignals.slice(1) : []),
    ...(/\b(?:existing|new)\b/i.test(coreScopeText) ? ["condition_marker"] : []),
  ]);

  return supportingSignals.length;
}

function analyzeScopeInputShape({
  coreScopeText = "",
  actions = [],
  quantities = [],
  quantityItemPairs = [],
  actionItemPhrases = [],
  locations = [],
  uncertaintyPhrases = [],
  technicalSignals = [],
} = {}) {
  const tokenCount = tokenizeWords(coreScopeText).length;
  const sentenceCount = Math.max(countInputSentences(coreScopeText), tokenCount ? 1 : 0);
  const clauseCount = estimateScopeClauseCount({ coreScopeText, actions, actionItemPhrases });
  const supportingDetailCount = countSupportingDetailSignals({
    coreScopeText,
    actions,
    quantities,
    quantityItemPairs,
    locations,
    uncertaintyPhrases,
    technicalSignals,
  });
  const supportingDetailDensity = Number((supportingDetailCount / Math.max(1, tokenCount)).toFixed(2));
  const veryShortInput = tokenCount > 0 && tokenCount <= 7;
  const singleClauseInput = clauseCount <= 1 && sentenceCount <= 1;
  const lowDetailDensity = supportingDetailDensity < (Array.isArray(technicalSignals) && technicalSignals.length ? 0.24 : 0.18);
  const terseTechnicalCommercialInput = Boolean(
    Array.isArray(technicalSignals)
    && technicalSignals.length
    && (
      veryShortInput
      || (tokenCount <= 12 && singleClauseInput && lowDetailDensity)
    )
  );

  return {
    tokenCount,
    sentenceCount,
    clauseCount,
    supportingDetailCount,
    supportingDetailDensity,
    veryShortInput,
    singleClauseInput,
    lowDetailDensity,
    terseTechnicalCommercialInput,
  };
}

function resolveTechnicalScopeCompleteness({
  coreScopeText = "",
  actions = [],
  items = [],
  quantityItemPairs = [],
  actionItemPhrases = [],
  locations = [],
  technicalSignals = [],
  inputShape = {},
} = {}) {
  if (!hasTechnicalScopeSignals({
    coreScopeText,
    actions,
    items,
    quantityItemPairs,
    actionItemPhrases,
    locations,
    technicalSignals,
    inputShape,
  })) return "";

  const tokenCount = Number(inputShape?.tokenCount || 0);
  const sentenceCount = Number(inputShape?.sentenceCount || 0);
  const clauseCount = Number(inputShape?.clauseCount || 0);
  const supportingDetailCount = Number(inputShape?.supportingDetailCount || 0);

  if (inputShape?.terseTechnicalCommercialInput || (tokenCount <= 10 && clauseCount <= 1)) {
    return "shorthand";
  }

  if (
    tokenCount >= 20
    || clauseCount >= 3
    || (sentenceCount >= 2 && tokenCount >= 16 && supportingDetailCount >= 6)
  ) {
    return "developed";
  }

  return "partial";
}

function resolveScopeExpansionPressure({
  detailLevel = "",
  formattingIntent = "",
  brevityIntent = "",
  expandRequested = false,
  inputShape = {},
  technicalScopeCompleteness = "",
  replaceableAssetScope = false,
  scopeWorkBucket = "",
  scopeAssetCategory = "",
  siteExteriorContext = false,
  commercialContextSignals = [],
  impliedAccessContext = "",
} = {}) {
  let pressureScore = 0;

  if (expandRequested) pressureScore += 3;
  if (inputShape?.veryShortInput) pressureScore += 2;
  if (inputShape?.singleClauseInput) pressureScore += 1;
  if (inputShape?.lowDetailDensity) pressureScore += 1;
  if (detailLevel === "vague") pressureScore += 1;
  if (technicalScopeCompleteness === "shorthand") pressureScore += 2;
  if (technicalScopeCompleteness === "developed") pressureScore -= 2;
  if (replaceableAssetScope && inputShape?.veryShortInput) pressureScore += 1;
  if (scopeWorkBucket && EXPANSION_WORK_BUCKETS.has(scopeWorkBucket)) pressureScore += 1;
  if (scopeAssetCategory && inputShape?.singleClauseInput) pressureScore += 1;
  if (siteExteriorContext && inputShape?.veryShortInput) pressureScore += 1;
  if (Array.isArray(commercialContextSignals) && commercialContextSignals.length && inputShape?.lowDetailDensity) pressureScore += 1;
  if (impliedAccessContext && inputShape?.singleClauseInput) pressureScore += 1;
  if (formattingIntent === "sentence") pressureScore -= 1;
  if (brevityIntent === "concise") pressureScore -= 1;

  if (pressureScore >= 4) return "high";
  if (pressureScore >= 2) return "medium";
  return "low";
}

function resolveScopeDetailLevel({ coreScopeText = "", actions = [], items = [], riskTriggerTerms = [], technicalSignals = [] } = {}) {
  if (hasTechnicalScopeSignals({ coreScopeText, actions, items, riskTriggerTerms, technicalSignals })) return "technical";

  const wordCount = tokenizeWords(coreScopeText).length;
  if (wordCount <= 4 && actions.length <= 1 && items.length <= 2) return "vague";
  if (wordCount <= 12 && (actions.length + items.length + riskTriggerTerms.length) <= 6) return "mid_detail";
  return "detailed";
}

function resolveScopeDepthTarget(detailLevel, {
  technicalScopeCompleteness = "",
  expandRequested = false,
  inputShape = {},
  scopeWorkBucket = "",
  scopeAssetCategory = "",
} = {}) {
  if (detailLevel === "technical") {
    if (technicalScopeCompleteness === "developed" && !expandRequested) return "light_refinement";
    return "technical_trade_expansion";
  }
  if (
    scopeWorkBucket
    && EXPANSION_WORK_BUCKETS.has(scopeWorkBucket)
    && (
      inputShape?.veryShortInput
      || inputShape?.singleClauseInput
      || (scopeAssetCategory && inputShape?.lowDetailDensity)
    )
  ) {
    return "fuller_scope_draft";
  }
  if (detailLevel === "vague") return "fuller_scope_draft";
  if (detailLevel === "mid_detail") return "moderate_expansion";
  return "light_refinement";
}

function extractRiskTriggerTerms(text) {
  const normalized = normalizeInstructionSpacing(text);
  return uniqueList(
    RISK_TRIGGER_PATTERNS
      .filter((entry) => entry.regex.test(normalized))
      .map((entry) => entry.label)
  );
}

function hasInstructionCue(text) {
  return Boolean(
    detectFormattingIntent(text)
    || detectBrevityIntent(text)
    || detectSafeWordingRequested(text)
    || detectExpandRequested(text)
    || detectRewriteIntents(text).length
  );
}

function stripInstructionPhrases(text) {
  let next = asText(text);
  const colonIndex = next.indexOf(":");
  if (colonIndex !== -1) {
    const prefix = next.slice(0, colonIndex);
    const suffix = next.slice(colonIndex + 1);
    if (hasInstructionCue(prefix) && suffix.trim()) next = suffix.trim();
  }

  const removablePatterns = [
    /\bput (?:this|these|it)?\s*(?:notes?)?\s*in bullets?\b/gi,
    /\bput (?:this|these|it)?\s*(?:notes?)?\s*in bullet points?\b/gi,
    /\buse bullet points?\b/gi,
    /\bbullet points?\b/gi,
    /\bbulleted\b/gi,
    /\bmake (?:it|this)\s+bullet points?\b/gi,
    /\bmake (?:it|this)\s+bullets?\b/gi,
    /\bnumber(?:ed)?\s+(?:list|lines?|points?)\b/gi,
    /\bmake (?:it|this)\s+numbered\b/gi,
    /\bclean this up\b/gi,
    /\bclean it up\b/gi,
    /\brewrite\b/gi,
    /\breword\b/gi,
    /\brewrite (?:this|it)?\s+as\s+(?:a\s+)?paragraph\b/gi,
    /\bin paragraph form\b/gi,
    /\bas a paragraph\b/gi,
    /\brewrite (?:this|it)?\s+as\s+(?:one|single)?\s*sentence\b/gi,
    /\bin one sentence\b/gi,
    /\bas one sentence\b/gi,
    /\bsingle sentence\b/gi,
    /\bsentence only\b/gi,
    /\bkeep (?:it|this) short\b/gi,
    /\bkeep (?:it|this) concise\b/gi,
    /\bmake (?:it|this)\s+shorter\b/gi,
    /\bmake (?:it|this)\s+more commercial\b/gi,
    /\bmake (?:it|this)\s+more technical\b/gi,
    /\bprofessionalize\b/gi,
    /\bprofessionally\b/gi,
    /\bconcise paragraph\b/gi,
    /\bconcise\b/gi,
    /\bexpand slightly\b/gi,
    /\belaborate a bit\b/gi,
    /\ba little more detail\b/gi,
    /\badd a bit more detail\b/gi,
    /\bsafe wording\b/gi,
    /\bsafer wording\b/gi,
    /\buncertainty[-\s]?aware\b/gi,
    /\bcontractor[-\s]?safe\b/gi,
    /\bprotective wording\b/gi,
    /\bqualified wording\b/gi,
  ];

  removablePatterns.forEach((pattern) => {
    next = next.replace(pattern, " ");
  });

  return next
    .replace(/^[\s,;:-]+/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,;:])/g, "$1")
    .trim();
}

function tokenizeWords(text) {
  return normalizeInstructionSpacing(text).toLowerCase().match(/[a-z0-9/-]+/g) || [];
}

function isQuantityToken(token) {
  return /^\d+(?:\.\d+)?$/.test(token) || NUMBER_WORDS.has(token);
}

function cleanCapturedPhrase(tokens, { keepLeadingQuantity = false } = {}) {
  let nextTokens = Array.isArray(tokens) ? tokens.slice() : [];
  while (nextTokens.length && ["the", "a", "an", "this", "that", "these", "those"].includes(nextTokens[0])) {
    nextTokens.shift();
  }
  if (!keepLeadingQuantity && nextTokens.length && isQuantityToken(nextTokens[0])) {
    nextTokens.shift();
  }
  while (nextTokens.length && CAPTURE_STOP_WORDS.has(nextTokens[nextTokens.length - 1])) {
    nextTokens.pop();
  }
  return nextTokens.join(" ").trim();
}

function matchActionPatternAt(tokens, index) {
  if (!Array.isArray(tokens) || index < 0 || index >= tokens.length) return null;
  const token = tokens[index];
  if (!ACTION_START_TOKENS.has(token)) return null;

  for (const entry of ACTION_SEQUENCE_PATTERNS) {
    if (entry.tokens[0] !== token) continue;
    let matched = true;
    for (let offset = 1; offset < entry.tokens.length; offset += 1) {
      if (tokens[index + offset] !== entry.tokens[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return {
        canonical: entry.canonical,
        family: entry.family,
        length: entry.tokens.length,
      };
    }
  }

  return null;
}

function matchSecondaryMethodAt(tokens, index) {
  if (!Array.isArray(tokens) || index < 0 || index >= tokens.length) return null;
  const token = tokens[index];
  const next = tokens[index + 1];
  const third = tokens[index + 2];

  if (["weld", "welded", "welding", "tack", "tacked", "tacking"].includes(token)) {
    return { method: "welded_connection", length: 1 };
  }
  if (token === "burn" && third === "in") return { method: "welded_connection", length: 3 };
  if (token === "punch" && next === "holes") return { method: "hole_creation", length: 2 };
  if (["punch", "drill", "core", "cut"].includes(token) && next === "in") return { method: "hole_creation", length: 2 };
  if (["punch", "drill", "core"].includes(token) && next === "through") return { method: "hole_creation", length: 2 };
  if (token === "anchor" && next === "down") return { method: "anchorage_connection", length: 2 };
  if (token === "anchor" && next === "it" && third === "down") return { method: "anchorage_connection", length: 3 };
  if (token === "anchor" && next === "it" && third === "back" && tokens[index + 3] === "down") return { method: "anchorage_connection", length: 4 };
  if (token === "bolt" && next === "up") return { method: "anchorage_connection", length: 2 };
  if (token === "bolt" && next === "it" && third === "up") return { method: "anchorage_connection", length: 3 };
  if (token === "bolt" && next === "back" && third === "up") return { method: "anchorage_connection", length: 3 };
  if (token === "bolt" && next === "it" && third === "back" && tokens[index + 3] === "up") return { method: "anchorage_connection", length: 4 };
  if (token === "fasten" && next === "off") return { method: "anchorage_connection", length: 2 };
  if (token === "fasten" && next === "it" && third === "off") return { method: "anchorage_connection", length: 3 };
  if (token === "fasten" && next === "it" && third === "back" && tokens[index + 3] === "off") return { method: "anchorage_connection", length: 4 };
  if (["secure", "secured", "securing"].includes(token)) return { method: "anchorage_connection", length: 1 };
  if (token === "seal" && next === "around") return { method: "perimeter_seal", length: 2 };
  if (token === "seal" && next === "it") return { method: "perimeter_seal", length: 2 };
  if (token === "flash") return { method: "perimeter_flashing", length: 1 };
  if (token === "mud" && next === "and" && third === "tape") return { method: "joint_finish", length: 3 };
  if (token === "float") return { method: "float_blend", length: 1 };
  if (token === "shim") return { method: "fit_adjustment", length: 1 };
  if (token === "sleeve") return { method: "penetration_sleeve", length: 1 };
  if (token === "wrap" && next === "post") return { method: "post_wrap", length: 2 };
  if (token === "cap" && (next === "it" || next === "off")) return { method: "closure_cap", length: 2 };
  if (token === "wire" && next === "up") return { method: "electrical_connection", length: 2 };
  if (token === "wire" && next === "it" && third === "up") return { method: "electrical_connection", length: 3 };

  return null;
}

function extractActionVerbs(text) {
  const normalized = normalizeInstructionSpacing(text).toLowerCase();
  const hits = ACTION_PATTERNS
    .map((entry) => ({ canonical: entry.canonical, index: normalized.search(entry.regex) }))
    .filter((entry) => entry.index !== -1)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.canonical);
  return uniqueList(hits);
}

function extractActionFamilies(text) {
  const normalized = normalizeInstructionSpacing(text).toLowerCase();
  const hits = ACTION_PATTERNS
    .map((entry) => ({ family: entry.family, index: normalized.search(entry.regex) }))
    .filter((entry) => entry.index !== -1)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.family);
  return uniqueList(hits);
}

function extractQuantities(text) {
  const matches = normalizeInstructionSpacing(text).toLowerCase().match(/\b(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g);
  return uniqueList(matches || []);
}

function extractQuantityItemPairs(text) {
  const tokens = tokenizeWords(text);
  const pairs = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (!isQuantityToken(tokens[index])) continue;
    const quantity = tokens[index];
    const phraseTokens = [];
    for (let inner = index + 1; inner < tokens.length && phraseTokens.length < 4; inner += 1) {
      const token = tokens[inner];
      if (LOCATION_PREPOSITIONS.has(token) || CAPTURE_STOP_WORDS.has(token) || matchActionPatternAt(tokens, inner)) break;
      if (["exclude", "excluding", "does", "do", "not"].includes(token)) break;
      if (token === "and" || token === "or") {
        const nextToken = tokens[inner + 1];
        if (!phraseTokens.length || matchActionPatternAt(tokens, inner + 1) || LOCATION_PREPOSITIONS.has(nextToken) || CAPTURE_STOP_WORDS.has(nextToken)) break;
        phraseTokens.push(token);
        continue;
      }
      phraseTokens.push(token);
    }
    const phrase = cleanCapturedPhrase(phraseTokens);
    if (phrase) pairs.push(`${quantity} ${phrase}`);
  }
  return uniqueList(pairs);
}

function extractActionItemPairs(text) {
  const tokens = tokenizeWords(text);
  const pairs = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const actionMatch = matchActionPatternAt(tokens, index);
    if (!actionMatch) continue;
    const action = actionMatch.canonical;

    const phraseTokens = [];
    for (let inner = index + actionMatch.length; inner < tokens.length && phraseTokens.length < 7; inner += 1) {
      const token = tokens[inner];
      const nextToken = tokens[inner + 1];
      if (LOCATION_PREPOSITIONS.has(token) && phraseTokens.length) break;
      if (CAPTURE_STOP_WORDS.has(token) || matchActionPatternAt(tokens, inner) || matchSecondaryMethodAt(tokens, inner) || ["exclude", "excluding", "does", "do", "not"].includes(token)) break;
      if (token === "as" && ["needed", "required"].includes(nextToken)) break;
      if (token === "if" && ["needed", "required", "damage", "damaged", "discovered", "found"].includes(nextToken)) break;
      if (token === "and" || token === "or") {
        if (!phraseTokens.length || matchActionPatternAt(tokens, inner + 1) || matchSecondaryMethodAt(tokens, inner + 1) || LOCATION_PREPOSITIONS.has(nextToken) || CAPTURE_STOP_WORDS.has(nextToken)) break;
        phraseTokens.push(token);
        continue;
      }
      phraseTokens.push(token);
    }

    const phrase = cleanCapturedPhrase(phraseTokens, { keepLeadingQuantity: true });
    if (phrase) pairs.push(`${action} ${phrase}`);
    index += actionMatch.length - 1;
  }
  return uniqueList(pairs);
}

function extractItemsFromActions(text) {
  const tokens = tokenizeWords(text);
  const items = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const actionMatch = matchActionPatternAt(tokens, index);
    if (!actionMatch) continue;
    const phraseTokens = [];
    for (let inner = index + actionMatch.length; inner < tokens.length && phraseTokens.length < 5; inner += 1) {
      const token = tokens[inner];
      if (LOCATION_PREPOSITIONS.has(token) || CAPTURE_STOP_WORDS.has(token)) break;
      if (matchActionPatternAt(tokens, inner) || matchSecondaryMethodAt(tokens, inner) || ["exclude", "excluding", "does", "do", "not"].includes(token)) break;
      if (token === "and" || token === "or") {
        const nextToken = tokens[inner + 1];
        if (!phraseTokens.length || matchActionPatternAt(tokens, inner + 1) || matchSecondaryMethodAt(tokens, inner + 1) || LOCATION_PREPOSITIONS.has(nextToken) || CAPTURE_STOP_WORDS.has(nextToken)) break;
        phraseTokens.push(token);
        continue;
      }
      if (token === "as" && ["needed", "required"].includes(tokens[inner + 1])) break;
      if (token === "if" && ["needed", "required", "damage", "damaged"].includes(tokens[inner + 1])) break;
      phraseTokens.push(token);
    }
    const phrase = cleanCapturedPhrase(phraseTokens);
    if (phrase) items.push(phrase);
    index += actionMatch.length - 1;
  }
  return uniqueList(items);
}

function extractLocations(text) {
  const normalized = normalizeInstructionSpacing(text).toLowerCase();
  const matches = [];
  const regex = /\b(?:in|at|near|around|within|inside|outside|throughout|on|from|by)\s+([a-z0-9/&-]+(?:\s+[a-z0-9/&-]+){0,3})/g;
  let match = regex.exec(normalized);
  while (match) {
    const rawTokens = match[1].split(/\s+/);
    const nextTokens = [];
    for (const token of rawTokens) {
      if (["with", "and", "or", "if", "as"].includes(token)) break;
      if (!CAPTURE_STOP_WORDS.has(token)) nextTokens.push(token);
    }
    const rawPhrase = nextTokens.join(" ").trim();
    if (rawPhrase) matches.push(rawPhrase);
    match = regex.exec(normalized);
  }
  return uniqueList(matches);
}

function resolveRoughActionAugmentation({ coreScopeText = "", actions = [], actionFamilies = [] } = {}) {
  const normalized = normalizeInstructionSpacing(coreScopeText).toLowerCase();
  const extraActions = [];
  const extraFamilies = [];
  const hasInstall = actionFamilies.includes("install_add_mount");
  const hasRemove = actionFamilies.includes("remove_demo");
  const hasFinish = actionFamilies.includes("finish_coating");
  const hasRepair = actionFamilies.includes("repair_patch");

  if (/\bput(?:ting)?(?:\s+(?:up|in))?\b/i.test(normalized) && !hasInstall) {
    extraActions.push("install");
    extraFamilies.push("install_add_mount");
  }

  if (/\bswap(?:ped|ping)?\b/i.test(normalized) && !actionFamilies.includes("replace_changeout")) {
    extraActions.push("replace");
    extraFamilies.push("replace_changeout");
  }

  if (/\bredo\b/i.test(normalized) && !actionFamilies.includes("repair_patch")) {
    extraActions.push("repair");
    extraFamilies.push("repair_patch");
  }

  if ((/\bmake\s+good\b/i.test(normalized) || /\bclose\s+in\b/i.test(normalized) || /\btighten(?:ed|ing)?\b/i.test(normalized)) && !hasRepair) {
    extraActions.push("repair");
    extraFamilies.push("repair_patch");
  }

  if (/\bframe(?:d|ing)?\s+out\b/i.test(normalized) && !hasInstall) {
    extraActions.push("install");
    extraFamilies.push("install_add_mount");
  }

  if (/\bframe\b.*\bopening\b/i.test(normalized) && !hasInstall) {
    extraActions.push("install");
    extraFamilies.push("install_add_mount");
  }

  if (/\bflash(?:ed|ing)?(?:\s+around)?\b/i.test(normalized) && !hasFinish) {
    extraActions.push("seal");
    extraFamilies.push("finish_coating");
  }

  if (
    /\bweld(?:ed|ing)?\b/i.test(normalized)
    && /\bbroken\b|\bdamaged\b|\brusted\b/i.test(normalized)
    && /\bfence\b|\bgate\b|\brailing\b|\bhandrail\b|\bguardrail\b/i.test(normalized)
    && !hasRepair
  ) {
    extraActions.push("repair");
    extraFamilies.push("repair_patch");
  }

  if (
    hasRemove
    && hasInstall
    && (
      /\bnew\b/i.test(normalized)
      || /\breplacement\b/i.test(normalized)
      || /\bput(?:ting)?\s+new\b/i.test(normalized)
      || /\bremove(?:d|ing)?(?:\s+and)?\s+replace(?:d|ing)?\b/i.test(normalized)
    )
    && !actionFamilies.includes("replace_changeout")
  ) {
    extraActions.push("replace");
    extraFamilies.push("replace_changeout");
  }

  if (
    /\bpatch(?:es|ed|ing)?\b/i.test(normalized)
    && /\b(?:re)?paint(?:ed|ing)?\b/i.test(normalized)
    && !extraActions.includes("patch")
  ) {
    extraActions.push("patch");
    extraFamilies.push("repair_patch");
    extraActions.push("paint");
    extraFamilies.push("finish_coating");
  }

  return {
    actions: uniqueList([...actions, ...extraActions]),
    actionFamilies: uniqueList([...actionFamilies, ...extraFamilies]),
  };
}

function resolveConditionDrivenActionAugmentation(analysis = {}) {
  const actions = Array.isArray(analysis?.actions) ? analysis.actions : [];
  const actionFamilies = Array.isArray(analysis?.actionFamilies) ? analysis.actionFamilies : [];
  const objectType = analysis?.objectType || "";
  const connectionModel = analysis?.connectionModel || "";
  const extraActions = [];
  const extraFamilies = [];
  const hasExplicitFamily = actionFamilies.length > 0;
  const methodOnlyFamilies = actionFamilies.length > 0 && actionFamilies.every((family) => ["service_connection", "install_add_mount"].includes(family));
  const replacementBias = hasCorpusMatch(analysis, CONDITION_REPLACEMENT_BIAS_REGEX);
  const repairBias = hasCorpusMatch(analysis, CONDITION_REPAIR_BIAS_REGEX);
  const objectSupportsReplacement = [
    "equipment_unit",
    "fixture_device",
    "hardware_component",
    "framed_opening_object",
    "opening_assembly",
    "panel_closure_object",
    "anchored_object",
    "mounted_object",
    "site_exterior_asset",
  ].includes(objectType);
  const corpusSupportsReplacement = objectSupportsReplacement
    || hasCorpusMatch(analysis, FRAMED_OPENING_OBJECT_REGEX)
    || hasCorpusMatch(analysis, PANEL_CLOSURE_OBJECT_REGEX)
    || hasCorpusMatch(analysis, TRIM_ACCESSORY_OBJECT_REGEX)
    || hasCorpusMatch(analysis, DOOR_HARDWARE_ASSET_REGEX)
    || hasCorpusMatch(analysis, SITE_HARDWARE_ASSET_REGEX);
  const objectSupportsRepair = [
    "repair_area",
    "trim_accessory_object",
    "hardware_component",
    "anchored_object",
    "mounted_object",
    "site_exterior_asset",
    "panel_closure_object",
    "opening_assembly",
    "framed_opening_object",
  ].includes(objectType);
  const corpusSupportsRepair = objectSupportsRepair
    || hasCorpusMatch(analysis, PANEL_CLOSURE_OBJECT_REGEX)
    || hasCorpusMatch(analysis, TRIM_ACCESSORY_OBJECT_REGEX)
    || hasCorpusMatch(analysis, DOOR_HARDWARE_ASSET_REGEX)
    || hasCorpusMatch(analysis, SITE_HARDWARE_ASSET_REGEX)
    || hasCorpusMatch(analysis, /\bbrackets?\b|\bcaps?\b|\bcovers?\b/i);
  const perimeterRepairBias = connectionModel === "perimeter_closure" && (
    repairBias
    || hasCorpusMatch(analysis, /\bsealant\b|\bcaulk\b|\bleak\b|\bwater\b|\baround\b/i)
  );
  const securementRepairCue = hasCorpusMatch(analysis, /\btighten(?:ed|ing)?\b|\b(?:re)?secure(?:d|ing)?\b|\bfasten(?:ed|ing)?\s+off\b|\banchor(?:ed|ing)?(?:\s+(?:it|them)\s+down)?\b|\bbolt(?:ed|ing)?(?:\s+(?:it|them|back))?\s+up\b/i);
  const lowLevelAdjustmentCue = hasCorpusMatch(analysis, /\badjust(?:ed|ing)?\b|\balign(?:ed|ing)?\b|\blevel(?:ed|ing)?\b|\bplumb\b|\bsquare\b|\brekey(?:ed|ing)?\b|\breattach(?:ed|ing)?\b|\brehang(?:ed|ing)?\b/i);
  const lowLevelComponentCue = hasCorpusMatch(analysis, DOOR_HARDWARE_ASSET_REGEX)
    || hasCorpusMatch(analysis, MINOR_HARDWARE_COMPONENT_REGEX)
    || hasCorpusMatch(analysis, LOW_LEVEL_TRIM_COMPONENT_REGEX)
    || hasCorpusMatch(analysis, PERIMETER_ACCESSORY_OBJECT_REGEX);
  const explicitInstallLead = hasCorpusMatch(analysis, /\binstall(?:ed|ing)?\b|\bnew\b|\bfurnish(?:ed|ing)?\s+and\s+install\b|\bprovide(?:d|ing)?\s+and\s+install\b|\bmount(?:ed|ing)?\b|\bset(?:ting)?\b|\bput(?:ting)?(?:\s+(?:up|in))\b/i);
  const flashingFinishCue = hasCorpusMatch(analysis, /\bflash(?:ed|ing)?(?:\s+around)?\b/i)
    && (connectionModel === "perimeter_closure" || ["trim_accessory_object", "panel_closure_object", "framed_opening_object", "opening_assembly"].includes(objectType));
  const siteWeldRepairCue = hasCorpusMatch(analysis, /\bweld(?:ed|ing)?\b/i)
    && hasCorpusMatch(analysis, /\bbroken\b|\bdamaged\b|\brusted\b|\bbad\b/i)
    && hasCorpusMatch(analysis, /\bfence\b|\bgate\b|\brailing\b|\bhandrail\b|\bguardrail\b/i);
  const repairAreaImplicitCue = objectType === "repair_area"
    && (replacementBias || repairBias || hasCorpusMatch(analysis, /\bmake\s+good\b|\bwall got wet\b|\bwater came in\b|\bstained\b|\bsoft\b/i));

  if (!hasExplicitFamily || methodOnlyFamilies) {
    if (
      (repairBias
        || repairAreaImplicitCue
        || securementRepairCue && !explicitInstallLead
        || lowLevelAdjustmentCue && (!explicitInstallLead || lowLevelComponentCue)
        || siteWeldRepairCue
        || hasCorpusMatch(analysis, VAGUE_REPAIR_ACTION_REGEX)
        || perimeterRepairBias)
      && corpusSupportsRepair
    ) {
      extraActions.push("repair");
      extraFamilies.push("repair_patch");
    } else if (replacementBias && corpusSupportsReplacement && !repairBias) {
      extraActions.push("replace");
      extraFamilies.push("replace_changeout");
    }
  }

  if (
    !actionFamilies.includes("finish_coating")
    && (hasCorpusMatch(analysis, /\bseal(?:ed|ing)?\b|\bcaulk(?:ed|ing)?\b|\bcaulking\b|\brepaint(?:ed|ing)?\b|\bpaint(?:ed|ing)?\b/i) || flashingFinishCue)
  ) {
    extraActions.push(hasCorpusMatch(analysis, /\bpaint(?:ed|ing)?\b|\brepaint(?:ed|ing)?\b/i) ? "paint" : "seal");
    extraFamilies.push("finish_coating");
  }

  return {
    actions: uniqueList([...(extraActions.length ? extraActions : []), ...actions, ...extraActions]),
    actionFamilies: uniqueList([...(extraFamilies.length ? extraFamilies : []), ...actionFamilies, ...extraFamilies]),
  };
}

function resolvePerimeterScopeHints(analysis = {}) {
  const hints = [];
  if (hasCorpusMatch(analysis, PERIMETER_SCOPE_HINT_REGEX)) hints.push("perimeter_scope");
  if (hasCorpusMatch(analysis, /\bseal(?:ant)?\s+around\b|\bcaulk(?:ing)?\s+around\b/i)) hints.push("perimeter_seal_scope");
  if (hasCorpusMatch(analysis, /\bweather[-\s]?strips?\b|\bweatherstrips?\b|\bperimeter seals?\b|\bedge seals?\b|\bframe seals?\b|\bgaskets?\b/i)) hints.push("perimeter_seal_scope");
  if (hasCorpusMatch(analysis, /\bflash(?:ed|ing)?\s+around\b/i)) hints.push("perimeter_flashing_scope");
  if (hasCorpusMatch(analysis, /\btrim\s+around\b/i)) hints.push("trim_transition_scope");
  if (hasCorpusMatch(analysis, /\bpatch\b.*\baround\b|\brepair\b.*\baround\b|\bfix\b.*\baround\b|\bredo\b.*\baround\b/i)) {
    hints.push("adjacent_finish_repair");
  }
  return uniqueList(hints);
}

function resolveLocationContextHints(analysis = {}) {
  const corpus = uniqueList([
    analysis?.coreScopeText,
    ...(Array.isArray(analysis?.locations) ? analysis.locations : []),
  ]).join(" ");

  return uniqueList(
    LOCATION_CONTEXT_HINT_PATTERNS
      .filter((entry) => entry.regex.test(corpus))
      .map((entry) => entry.label)
  );
}

function resolveResetIntent(analysis = {}) {
  const actionFamilies = Array.isArray(analysis?.actionFamilies) ? analysis.actionFamilies : [];
  const rawScopeText = uniqueList([analysis?.rawScopeText, analysis?.coreScopeText]).join(" ");
  const hasResetCue = RESET_SCOPE_HINT_REGEX.test(rawScopeText);
  const removeAndInstall = actionFamilies.includes("remove_demo") && actionFamilies.includes("install_add_mount");
  const replacementCue = /\bnew\b|\breplacement\b|\bremove(?:d|ing)?(?:\s+and)?\s+replace(?:d|ing)?\b|\bremove\/replace\b/i.test(rawScopeText);
  if (!hasResetCue && !removeAndInstall) return "";
  if (TEMPORARY_RESET_REASON_REGEX.test(rawScopeText)) return "temporary_remove_reinstall";
  if (/\breinstall\b|\breset\b|\bput back\b|\bpull and resecure\b|\bremove panel for access and reinstall\b|\bremove trim and reinstall\b/i.test(rawScopeText)) {
    return "remove_reinstall";
  }
  return removeAndInstall && !replacementCue ? "remove_reinstall" : "";
}

function resolvePartialScopeHints(analysis = {}) {
  const hints = [];
  if (hasCorpusMatch(analysis, /\bsection\b/i)) hints.push("section_scope");
  if (hasCorpusMatch(analysis, /\bside\b|\bone side\b|\bback side\b|\brear side\b/i)) hints.push("side_scope");
  if (hasCorpusMatch(analysis, /\bcorner\b/i)) hints.push("corner_scope");
  if (hasCorpusMatch(analysis, /\bpiece\b|\bbottom piece\b/i)) hints.push("piece_scope");
  if (hasCorpusMatch(analysis, /\blower\b/i)) hints.push("lower_scope");
  if (hasCorpusMatch(analysis, /\bupper\b/i)) hints.push("upper_scope");
  if (hasCorpusMatch(analysis, /\bend\b/i)) hints.push("end_scope");
  if (hasCorpusMatch(analysis, /\bedge\b/i)) hints.push("edge_scope");
  if (
    hasCorpusMatch(analysis, /\brun\b/i)
    && (
      hasCorpusMatch(analysis, INTERIOR_BUILTIN_ASSET_REGEX)
      || hasCorpusMatch(analysis, /\bcasework\b|\bmillwork\b|\bcabinets?\b|\bvanit(?:y|ies)\b/i)
    )
  ) {
    hints.push("run_scope");
  }
  if (hasCorpusMatch(analysis, /\belevation\b/i)) hints.push("elevation_scope");
  if (hasCorpusMatch(analysis, /\barea\b|\baffected area\b/i)) hints.push("area_scope");
  if (hasCorpusMatch(analysis, /\baround\b/i)) hints.push("perimeter_local_scope");
  if (hasCorpusMatch(analysis, PARTIAL_SCOPE_HINT_REGEX) && !hints.length) hints.push("localized_scope");
  return uniqueList(hints);
}

function hasMidLevelAdjacentMakeGoodScope(analysis = {}) {
  return hasCorpusMatch(analysis, MID_LEVEL_ADJACENT_MAKE_GOOD_REGEX);
}

function hasMidLevelFinishFollowupScope(analysis = {}) {
  return hasCorpusMatch(analysis, MID_LEVEL_FINISH_FOLLOWUP_REGEX);
}

function hasMidLevelPerimeterFollowupScope(analysis = {}) {
  return hasCorpusMatch(analysis, MID_LEVEL_PERIMETER_FOLLOWUP_REGEX);
}

function hasMidLevelSecurementFollowupScope(analysis = {}) {
  return hasCorpusMatch(analysis, MID_LEVEL_SECUREMENT_FOLLOWUP_REGEX);
}

function resolveOpeningClosureHints(analysis = {}) {
  const hints = [];
  if (
    hasCorpusMatch(analysis, OPENING_CLOSURE_HINT_REGEX)
    && !hasCorpusMatch(analysis, /\baccess doors?\b|\bpanel doors?\b/i)
  ) {
    hints.push("opening_closure");
  }
  if (hasCorpusMatch(analysis, /\bold opening\b|\bold door opening\b/i)) hints.push("old_opening");
  if (hasCorpusMatch(analysis, /\bclose(?:d|ing)?(?:\s+it)?\s+up\b|\bclose\s+in\b/i)) hints.push("close_up_scope");
  if (hasCorpusMatch(analysis, /\bframe\b.*\bopening\b/i)) hints.push("framed_closure_support");
  if (hasCorpusMatch(analysis, /\bpatch\s+around\s+opening\b|\brepair\s+around\s+opening\b/i)) hints.push("opening_perimeter_repair");
  return uniqueList(hints);
}

function resolveWaterDamageRepairHints(analysis = {}) {
  const hints = [];
  if (hasCorpusMatch(analysis, WATER_DAMAGE_CONTEXT_REGEX)) hints.push("water_damage_repair");
  if (hasCorpusMatch(analysis, /\bleak(?:\s+damage)?\b|\bvisible leak damage\b/i)) hints.push("leak_damage_repair");
  if (hints.length && hasCorpusMatch(analysis, /\baround\b.*\bwindow\b|\bby\b.*\bwindow\b|\bat\b.*\bwindow\b/i)) hints.push("adjacent_window_repair");
  if (hasCorpusMatch(analysis, /\bceiling\b/i) && hints.length) hints.push("ceiling_repair_area");
  if (hasCorpusMatch(analysis, /\bwall\b/i) && hints.length) hints.push("wall_repair_area");
  return uniqueList(hints);
}

function resolveExtentLightScopeHints(analysis = {}) {
  const hints = [];
  const quantities = Array.isArray(analysis?.quantities) ? analysis.quantities : [];
  const items = Array.isArray(analysis?.items) ? analysis.items : [];
  if (!quantities.length && items.length && hasCorpusMatch(analysis, /\bwindows?\b|\bholes?\b|\bpanels?\b|\bfence\b|\brailing\b/i)) {
    hints.push("unstated_quantity");
  }
  if (hasCorpusMatch(analysis, /\bidentified (?:locations?|sections?|areas?)\b|\bstated (?:locations?|sections?|areas?)\b/i)) {
    hints.push("stated_extent");
  }
  if (hasCorpusMatch(analysis, /\bsection\b|\bside\b|\bcorner\b|\barea\b|\baround\b/i)) {
    hints.push("localized_extent");
  }
  return uniqueList(hints);
}

// Splits a scope prompt into mid-band analysis clauses at definite clause boundaries
// (comma, semicolon, "then", "after") and at "and" when it connects two action+object units.
// Compound action pairs like "patch and paint", "remove and replace" are kept together.
function splitIntoMidBandClauses(text) {
  if (!text || typeof text !== "string") return [text || ""];
  // Split on definite clause boundaries first: comma, semicolon, "then", "after [that]"
  const primarySegments = text
    .split(/\s*[,;]\s*|\s+(?:then|after(?:\s+that)?)\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const clauses = [];
  for (const segment of primarySegments) {
    const andParts = segment.split(/\s+and\s+/i);
    if (andParts.length <= 1) {
      clauses.push(segment);
      continue;
    }
    // Check each "and": if the word before "and" is an action verb, it is a compound pair — keep together
    let current = andParts[0];
    for (let i = 1; i < andParts.length; i++) {
      const prevWords = tokenizeWords(current.trim());
      const prevLastWord = prevWords[prevWords.length - 1] || "";
      const prevSecondToLastWord = prevWords[prevWords.length - 2] || "";
      // If prevLastWord is an action verb BUT the word before it is a noun-position cue
      // (determiner, demonstrative, or replacement-action verb), the term is likely a NOUN — split instead of fuse
      const isNounPosition = OVERLOADED_NOUN_POSITION_CUES_REGEX.test(prevSecondToLastWord);
      if (MID_BAND_CLAUSE_ACTION_VERB_REGEX.test(prevLastWord) && !isNounPosition) {
        current = current + " and " + andParts[i];
      } else {
        clauses.push(current.trim());
        current = andParts[i];
      }
    }
    clauses.push(current.trim());
  }
  return clauses.filter(Boolean);
}

// Evaluates a single clause for object strength: strong (named construction object as direct target),
// weak (only generic extent words or surface nouns), or neutral (specific but non-listed object).
function resolveMidBandClauseStrength(clauseText) {
  if (!clauseText || typeof clauseText !== "string") return { strong: false, weak: false, surface: false };
  const text = clauseText.trim();
  // Context/qualifier fragments with no action verb are neutral (e.g., "water damage", "after leak")
  if (!/\b(?:repair|patch|paint|replace|remove|install|fix|redo|restore|make|clean|seal|apply|fill|caulk|grout|prep|prime|cover|treat|coat|wrap|align|secure|fasten|anchor|reinforce|cut|fit|adjust|trim|strip|finish|demo|rebuild|add)\b/i.test(text)) {
    return { strong: false, weak: false, surface: false };
  }
  // Isolate direct object portion by splitting at first location preposition
  const directObjectText =
    text.split(/\s+(?:in|at|near|around|along|above|below|beside|behind|next\s+to|adjacent\s+to|by)\s+/i)[0] || text;
  // Strong: a named construction object is the direct target (not just location context)
  if (MID_BAND_STRONG_OBJECT_REGEX.test(directObjectText)) {
    return { strong: true, weak: false, surface: false };
  }
  // Weak surface: generic construction surface word present
  const hasSurface = MID_BAND_GENERIC_SURFACE_REGEX.test(text);
  // Weak extent: only generic size/area words as content
  const hasWeakExtent =
    /\b(?:(?:affected|damaged|bad|old|worn|broken|failed|cracked|soft|loose|stained|visible|dirty)\s+)?(?:area|section|part|piece|spot|place|zone|location|damage)s?(?:\s+(?:here|there|above|below))?\b/i.test(text);
  return { strong: false, weak: hasSurface || hasWeakExtent, surface: hasSurface };
}

function resolveMidBandAmbiguityControl(analysis = {}) {
  const actionFamilies = Array.isArray(analysis?.actionFamilies) ? analysis.actionFamilies : [];
  const actions = Array.isArray(analysis?.actions) ? analysis.actions : [];
  const items = Array.isArray(analysis?.items) ? analysis.items : [];
  const openingClosureHints = Array.isArray(analysis?.openingClosureHints) ? analysis.openingClosureHints : [];

  // Only engage for repair/patch/fix or replace families
  const isRepairFamily = actionFamilies.includes("repair_patch") || actions.some((a) => ["repair", "patch", "restore", "fix"].includes(a));
  const isReplaceFamily = actionFamilies.includes("replace_changeout");
  if (!isRepairFamily && !isReplaceFamily) return {};

  // Full scope escalation overrides mid-band bias
  if (hasCorpusMatch(analysis, MID_BAND_FULL_SCOPE_ESCALATION_REGEX)) return {};

  // Opening closure with intentional close/frame action — bypass (specific routing already active)
  if (openingClosureHints.some((h) => ["old_opening", "close_up_scope", "framed_closure_support"].includes(h))) return {};

  // ── Clause-local evaluation (Pass 2) ──
  // When a prompt has multiple clauses, evaluate each clause independently so that a strong-object
  // clause and a weak-object clause in the same prompt do not cancel each other out.
  const rawText = analysis?.rawScopeText || analysis?.coreScopeText || "";
  const clauses = splitIntoMidBandClauses(rawText);
  if (clauses.length > 1) {
    let hasStrongClause = false;
    let hasWeakClause = false;
    let weakClauseSurface = false;
    for (const clause of clauses) {
      const strength = resolveMidBandClauseStrength(clause);
      if (strength.strong) hasStrongClause = true;
      if (strength.weak) {
        hasWeakClause = true;
        if (strength.surface) weakClauseSurface = true;
      }
    }
    // All strong, no weak — no mid-band control needed
    if (hasStrongClause && !hasWeakClause) return {};
    // Mixed: strong clause AND weak clause — apply bias only to the weak clause
    if (hasStrongClause && hasWeakClause) {
      const hasWaterDamage = Array.isArray(analysis?.waterDamageRepairHints) && analysis.waterDamageRepairHints.length > 0;
      let weakClauseBiasPhrasing;
      if (weakClauseSurface) {
        weakClauseBiasPhrasing = hasWaterDamage ? "localized_water_damage_surface_repair" : "localized_surface_repair";
      } else if (hasWaterDamage) {
        weakClauseBiasPhrasing = "localized_water_damage_area_repair";
      } else {
        weakClauseBiasPhrasing = "bounded_section_area";
      }
      return { midBandAmbiguity: true, midBandBiasPhrasing: weakClauseBiasPhrasing, hasStrongClause: true, hasWeakClause: true, weakClauseBiasPhrasing };
    }
    // All weak or all neutral — fall through to existing whole-prompt logic below
  }

  // ── Demonstrative + specific object bypass (Pass 4) ──
  // When "this/that/these/those" directly precedes a bounded or strong construction object,
  // extractItemsFromActions stops at the demonstrative so items may be empty — but the object IS
  // specific. Bypass weak-extent mid-band bias to avoid false bounded_section_area output.
  if (DEMONSTRATIVE_BOUNDED_OBJECT_REGEX.test(rawText) || DEMONSTRATIVE_STRONG_OBJECT_REGEX.test(rawText)) return {};

  // ── Existing whole-prompt logic (single clause, or multi-clause with no strong clause) ──
  // Check action targets (items + actionItemPhrases) for strong named construction objects
  // NOTE: only check direct-object fields, NOT locations or rawScopeText, to avoid false bypasses
  // when a strong noun appears only as location context ("repair section AT fence")
  const actionTargets = uniqueList([
    ...(Array.isArray(analysis?.actionItemPhrases) ? analysis.actionItemPhrases : []),
    ...items,
  ]).join(" ");
  if (MID_BAND_STRONG_OBJECT_REGEX.test(actionTargets)) return {};

  // Determine object strength from items (direct objects of action verbs)
  const combinedItems = items.join(" ");
  const allItemsAreWeakExtent = items.length === 0 || items.every((item) => MID_BAND_WEAK_EXTENT_ITEM_REGEX.test(item));
  const hasGenericSurfaceInItems = MID_BAND_GENERIC_SURFACE_REGEX.test(combinedItems);
  const hasGenericSurfaceInCorpus = hasCorpusMatch(analysis, MID_BAND_GENERIC_SURFACE_REGEX);
  const hasWaterDamage = Array.isArray(analysis?.waterDamageRepairHints) && analysis.waterDamageRepairHints.length > 0;

  // Only fire mid-band when items are weak extent words or generic surface without named object
  if (!allItemsAreWeakExtent && !hasGenericSurfaceInItems) return {};

  // Determine bias phrasing
  let midBandBiasPhrasing;
  if (hasGenericSurfaceInItems || hasGenericSurfaceInCorpus) {
    midBandBiasPhrasing = hasWaterDamage ? "localized_water_damage_surface_repair" : "localized_surface_repair";
  } else if (hasWaterDamage) {
    midBandBiasPhrasing = "localized_water_damage_area_repair";
  } else {
    midBandBiasPhrasing = "bounded_section_area";
  }

  return { midBandAmbiguity: true, midBandBiasPhrasing };
}

// Detects referential follow-up language in multi-clause prompts.
// Only inspects clauses after the first to avoid false-positives from primary scope descriptions
// (e.g., "replace trim around door" is primary; "paint it" after "and" is the follow-up).
function resolveReferentialFollowUpHints(analysis = {}) {
  const hints = [];
  const rawText = analysis?.rawScopeText || analysis?.coreScopeText || "";
  if (!rawText) return hints;

  const clauses = splitIntoMidBandClauses(rawText);
  // Only check follow-up clauses (everything after the first clause) for referential patterns
  if (clauses.length <= 1) return hints;
  const followUpText = clauses.slice(1).join(" ");
  if (!followUpText) return hints;

  // Perimeter follow-up: "around it", "around them", "around frame", "around opening", etc.
  if (REFERENTIAL_PERIMETER_PATTERN_REGEX.test(followUpText)) hints.push("perimeter_follow_up");

  // Action + pronoun follow-up: "seal it", "paint it", "weld it up", "secure it", "finish it"
  if (REFERENTIAL_ACTION_PRONOUN_REGEX.test(followUpText)) hints.push("action_pronoun_follow_up");

  // Adjacent / surrounding area follow-up: "adjacent wall area", "surrounding surface"
  if (REFERENTIAL_ADJACENT_AREA_REGEX.test(followUpText)) hints.push("adjacent_area_follow_up");

  // After-work follow-up: "patch wall after", "make good after install"
  // Exclude water/damage "after" contexts already routed by waterDamageRepairHints
  if (
    REFERENTIAL_AFTER_WORK_REGEX.test(followUpText) &&
    !hasCorpusMatch(analysis, /\bafter\s+(?:leak|storm|flood|damage|fire|water)\b/i)
  ) {
    hints.push("after_work_follow_up");
  }

  return uniqueList(hints);
}

// Detects demonstrative modifier patterns (this/that/these/those + noun) across the full prompt.
// Returns hint types that distinguish weak-extent, generic-surface, bounded-object, and strong-object
// demonstrative uses so the AI prompt can anchor scope to the appropriate specificity level.
function resolveDemonstrativeModifierHints(analysis = {}) {
  const hints = [];
  const rawText = analysis?.rawScopeText || analysis?.coreScopeText || "";
  if (!rawText) return hints;
  if (DEMONSTRATIVE_WEAK_EXTENT_REGEX.test(rawText)) hints.push("demonstrative_weak_extent");
  if (DEMONSTRATIVE_GENERIC_SURFACE_REGEX.test(rawText)) hints.push("demonstrative_generic_surface");
  if (DEMONSTRATIVE_BOUNDED_OBJECT_REGEX.test(rawText)) hints.push("demonstrative_bounded_object");
  if (DEMONSTRATIVE_STRONG_OBJECT_REGEX.test(rawText)) hints.push("demonstrative_strong_object");
  return uniqueList(hints);
}

// Detects multi-anchor zone separation: prompts where ≥ 2 distinct clauses each carry their own
// explicit "at/in [location]" anchor (e.g., "replace door at entry and patch wall at window").
// When active, each clause must be kept bound to its own stated object and location — no cross-clause bleed.
function resolveMultiAnchorSeparationHints(analysis = {}) {
  const rawText = analysis?.rawScopeText || analysis?.coreScopeText || "";
  if (!rawText) return { multiAnchorSeparationActive: false };
  const clauses = splitIntoMidBandClauses(rawText);
  if (clauses.length <= 1) return { multiAnchorSeparationActive: false };
  let anchoredClauseCount = 0;
  for (const clause of clauses) {
    if (CLAUSE_LOCATION_ANCHOR_REGEX.test(clause)) {
      anchoredClauseCount++;
    }
  }
  if (anchoredClauseCount >= 2) {
    return { multiAnchorSeparationActive: true, anchoredClauseCount };
  }
  return { multiAnchorSeparationActive: false };
}

// Detects relative/comparative zone language (Pass 7): same/other/opposite/left/right/inside/outside/
// front/rear/adjacent/nearby used as bounded clause-local zone anchors.
// Returns hint types classifying the relative zone language and whether ≥ 2 clauses each have
// their own relative zone anchor (relativeZoneSeparationActive).
function resolveRelativeZoneHints(analysis = {}) {
  const rawText = analysis?.rawScopeText || analysis?.coreScopeText || "";
  if (!rawText) return { relativeZoneHints: [], relativeZoneSeparationActive: false };
  const hints = [];
  if (RELATIVE_SIDE_CONTRAST_REGEX.test(rawText)) hints.push("relative_side_contrast");
  if (RELATIVE_INTERIOR_EXTERIOR_REGEX.test(rawText)) hints.push("relative_interior_exterior");
  if (RELATIVE_FRONT_REAR_REGEX.test(rawText)) hints.push("relative_front_rear");
  if (RELATIVE_SAME_ZONE_REGEX.test(rawText)) hints.push("relative_same");
  if (RELATIVE_OPPOSITE_REGEX.test(rawText)) hints.push("relative_opposite");
  if (RELATIVE_ADJACENT_NEARBY_REGEX.test(rawText)) hints.push("relative_adjacent_nearby");
  if (!hints.length) return { relativeZoneHints: [], relativeZoneSeparationActive: false };
  // Count how many distinct clauses have their own relative zone anchor
  const clauses = splitIntoMidBandClauses(rawText);
  let relativeAnchoredCount = 0;
  for (const clause of clauses) {
    if (CLAUSE_RELATIVE_ZONE_REGEX.test(clause)) relativeAnchoredCount++;
  }
  return {
    relativeZoneHints: uniqueList(hints),
    relativeZoneSeparationActive: relativeAnchoredCount >= 2,
  };
}

// Detects sparse directional zone shorthand and 3+-clause spatial chains (Pass 8).
// sparse_directional_zone: action verb + bare zone word (inside, outside, front, rear, edge, center, etc.)
//   used without an explicit qualifier — keeps the zone bounded and localized.
// multi_zone_chain: 3 or more clauses each carry their own spatial anchor (relative-zone OR sparse zone).
//   all zones in the chain must stay separated; no zone may bleed into adjacent zones.
function resolveMultiZoneChainHints(analysis = {}) {
  const rawText = analysis?.rawScopeText || analysis?.coreScopeText || "";
  if (!rawText) return { multiZoneChainHints: [], multiZoneChainActive: false };
  const hints = [];
  if (SPARSE_DIRECTIONAL_ZONE_REGEX.test(rawText)) hints.push("sparse_directional_zone");
  // Count clauses anchored by either Pass 7 relative-zone or Pass 8 sparse-zone
  const clauses = splitIntoMidBandClauses(rawText);
  let anchoredCount = 0;
  for (const clause of clauses) {
    if (CLAUSE_RELATIVE_ZONE_REGEX.test(clause) || SPARSE_DIRECTIONAL_ZONE_REGEX.test(clause)) {
      anchoredCount++;
    }
  }
  if (anchoredCount >= 3) hints.push("multi_zone_chain");
  if (!hints.length) return { multiZoneChainHints: [], multiZoneChainActive: false };
  return {
    multiZoneChainHints: uniqueList(hints),
    multiZoneChainActive: anchoredCount >= 3,
  };
}

function resolveCoverageExtentHints(analysis = {}) {
  const rawText = analysis?.rawScopeText || analysis?.coreScopeText || "";
  if (!rawText) return { coverageExtentHints: [], coverageExtentActive: false };
  const hints = [];
  if (COVERAGE_BOTH_SIDES_REGEX.test(rawText)) hints.push("both_sides");
  if (COVERAGE_PERIMETER_REGEX.test(rawText)) hints.push("perimeter_wraparound");
  if (COVERAGE_WHOLE_SURFACE_REGEX.test(rawText)) hints.push("whole_local_surface");
  if (COVERAGE_REMAINDER_REGEX.test(rawText)) hints.push("remainder_partial");
  if (COVERAGE_RUN_SPAN_EDGE_REGEX.test(rawText)) hints.push("run_span_edge");
  if (!hints.length) return { coverageExtentHints: [], coverageExtentActive: false };
  return {
    coverageExtentHints: uniqueList(hints),
    coverageExtentActive: true,
  };
}

function resolveOrdinalCountStackedHints(analysis = {}) {
  const rawText = analysis?.rawScopeText || analysis?.coreScopeText || "";
  if (!rawText) return { ordinalCountStackedHints: [], ordinalCountStackedActive: false };
  const hints = [];
  if (ORDINAL_LOCAL_SELECTOR_REGEX.test(rawText)) hints.push("ordinal_local_selection");
  if (COUNT_LOCAL_EXTENT_REGEX.test(rawText)) hints.push("count_local_extent");
  if (STACKED_EXTENT_LOCATION_REGEX.test(rawText)) hints.push("stacked_extent_location");
  if (!hints.length) return { ordinalCountStackedHints: [], ordinalCountStackedActive: false };
  return {
    ordinalCountStackedHints: uniqueList(hints),
    ordinalCountStackedActive: true,
  };
}

function resolveRangePositionalFractionalHints(analysis = {}) {
  const rawText = analysis?.rawScopeText || analysis?.coreScopeText || "";
  if (!rawText) return { rangePositionalFractionalHints: [], rangePositionalFractionalActive: false };
  const hints = [];
  if (ORDINAL_RANGE_SELECTION_REGEX.test(rawText)) hints.push("ordinal_range_selection");
  if (POSITIONAL_LOCAL_SELECTOR_REGEX.test(rawText)) hints.push("positional_local_selection");
  if (FRACTIONAL_LOCAL_EXTENT_REGEX.test(rawText)) hints.push("fractional_local_extent");
  if (MIXED_SELECTION_LOCATION_REGEX.test(rawText)) hints.push("mixed_selection_location");
  if (!hints.length) return { rangePositionalFractionalHints: [], rangePositionalFractionalActive: false };
  return {
    rangePositionalFractionalHints: uniqueList(hints),
    rangePositionalFractionalActive: true,
  };
}

function resolveAnchorCarrySubzoneHints(analysis = {}) {
  const rawText = analysis?.rawScopeText || analysis?.coreScopeText || "";
  if (!rawText) return { anchorCarrySubzoneHints: [], anchorCarrySubzoneActive: false };
  const hints = [];
  if (RANGE_ANCHOR_CARRY_REGEX.test(rawText)) hints.push("range_anchor_carry");
  if (FRACTION_ANCHOR_CARRY_REGEX.test(rawText)) hints.push("fraction_anchor_carry");
  if (POSITION_OF_LOCAL_REGEX.test(rawText)) hints.push("position_of_local");
  if (NAMED_SUBZONE_REGEX.test(rawText)) hints.push("named_subzone_local");
  if (!hints.length) return { anchorCarrySubzoneHints: [], anchorCarrySubzoneActive: false };
  return {
    anchorCarrySubzoneHints: uniqueList(hints),
    anchorCarrySubzoneActive: true,
  };
}

function resolveCoordinatedDistributionHints(analysis = {}) {
  const rawText = analysis?.rawScopeText || analysis?.coreScopeText || "";
  if (!rawText) return { coordinatedDistributionHints: [], coordinatedDistributionActive: false };
  const hints = [];
  if (COORDINATED_POSITION_DIST_REGEX.test(rawText)) hints.push("coordinated_position_distribution");
  if (COORDINATED_SELECTION_DIST_REGEX.test(rawText)) hints.push("coordinated_selection_distribution");
  const subzoneMatches = rawText.match(new RegExp(NAMED_SUBZONE_REGEX.source, "gi")) || [];
  if (subzoneMatches.length >= 2) hints.push("coordinated_subzone_distribution");
  if (COORDINATED_LOCAL_MEMBERS_REGEX.test(rawText)) hints.push("coordinated_local_members");
  if (!hints.length) return { coordinatedDistributionHints: [], coordinatedDistributionActive: false };
  return {
    coordinatedDistributionHints: uniqueList(hints),
    coordinatedDistributionActive: true,
  };
}

function resolveWeldingNormalization(analysis = {}) {
  const rawText = analysis?.rawScopeText || analysis?.coreScopeText || "";
  if (!rawText || !WELDING_INTENT_REGEX.test(rawText)) {
    return {
      weldingBaseProcess: "",
      weldingSecondaryTags: [],
      weldingMaterialContext: [],
      weldingScopeBias: [],
      weldingConfidence: "none",
      weldingRelatedNotWelding: [],
    };
  }

  // Detect allied-but-not-welding processes
  const relatedNotWelding = [];
  for (const { canonical, patterns } of ALLIED_NOT_WELDING_PROCESSES) {
    if (patterns.some((rx) => rx.test(rawText)) && !relatedNotWelding.includes(canonical)) {
      relatedNotWelding.push(canonical);
    }
  }

  // Determine base process (first match wins; welding_generic is fallback)
  let baseProcess = "";
  let baseExplicit = false;
  for (const { key, patterns } of WELDING_BASE_PROCESS_PATTERNS) {
    if (key === "welding_generic") {
      if (!baseProcess) baseProcess = key;
      break;
    }
    if (patterns.some((rx) => rx.test(rawText))) {
      baseProcess = key;
      baseExplicit = true;
      break;
    }
  }

  // Collect secondary execution/application tags
  const secondaryTags = [];
  for (const { key, patterns } of WELDING_SECONDARY_PATTERNS) {
    if (patterns.some((rx) => rx.test(rawText))) secondaryTags.push(key);
  }

  // Infer derived secondary tags: orbital welding is by definition automated
  if (secondaryTags.includes("orbital_welding") && !secondaryTags.includes("automatic_welding")) {
    secondaryTags.push("automatic_welding");
  }

  // Infer base process from strong secondary signals when base is generic
  let baseInferred = false;
  if (!baseExplicit) {
    if (secondaryTags.includes("orbital_welding") || secondaryTags.includes("sanitary_tube_welding")) {
      baseProcess = "gtaw_tig";
      baseInferred = true;
    }
  }

  // Collect material context
  const materialContext = [];
  for (const { key, patterns } of WELDING_MATERIAL_PATTERNS) {
    if (patterns.some((rx) => rx.test(rawText))) materialContext.push(key);
  }

  // Collect scope bias
  const scopeBias = [];
  for (const { key, patterns } of WELDING_SCOPE_BIAS_PATTERNS) {
    if (patterns.some((rx) => rx.test(rawText))) scopeBias.push(key);
  }

  // Determine detection confidence
  let confidence;
  if (baseExplicit) {
    confidence = secondaryTags.length > 0 || materialContext.length > 0 ? "high" : "medium";
  } else if (baseInferred) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  return {
    weldingBaseProcess: baseProcess,
    weldingSecondaryTags: uniqueList(secondaryTags),
    weldingMaterialContext: uniqueList(materialContext),
    weldingScopeBias: uniqueList(scopeBias),
    weldingConfidence: confidence,
    weldingRelatedNotWelding: uniqueList(relatedNotWelding),
  };
}

function resolveIronworkNormalization(analysis = {}) {
  const rawText = analysis?.rawScopeText || analysis?.coreScopeText || "";
  if (!rawText || !IRONWORK_INTENT_REGEX.test(rawText)) {
    return {
      ironworkTradeFamily: "",
      ironworkOperationTags: [],
      ironworkObjectTags: [],
      ironworkScopeBias: [],
      ironworkConfidence: "none",
    };
  }

  // Determine trade family (first match wins; miscellaneous_metals is fallback)
  let tradeFamily = "";
  let familyExplicit = false;
  for (const { key, patterns } of IRONWORK_TRADE_FAMILY_PATTERNS) {
    if (key === "miscellaneous_metals") {
      if (!tradeFamily) tradeFamily = key;
      break;
    }
    if (patterns.some((rx) => rx.test(rawText))) {
      tradeFamily = key;
      familyExplicit = true;
      break;
    }
  }

  // Collect operation tags
  const operationTags = [];
  for (const { key, patterns } of IRONWORK_OPERATION_PATTERNS) {
    if (patterns.some((rx) => rx.test(rawText))) operationTags.push(key);
  }

  // Collect object/assembly tags
  const objectTags = [];
  for (const { key, patterns } of IRONWORK_OBJECT_PATTERNS) {
    if (patterns.some((rx) => rx.test(rawText))) objectTags.push(key);
  }

  // Collect scope bias
  const scopeBias = [];
  for (const { key, patterns } of IRONWORK_SCOPE_BIAS_PATTERNS) {
    if (patterns.some((rx) => rx.test(rawText))) scopeBias.push(key);
  }

  // Determine confidence
  let confidence;
  if (familyExplicit) {
    confidence = operationTags.length > 0 || objectTags.length > 0 ? "high" : "medium";
  } else {
    confidence = "low";
  }

  return {
    ironworkTradeFamily: tradeFamily,
    ironworkOperationTags: uniqueList(operationTags),
    ironworkObjectTags: uniqueList(objectTags),
    ironworkScopeBias: uniqueList(scopeBias),
    ironworkConfidence: confidence,
  };
}

function resolveCarpentryNormalization(analysis = {}) {
  const rawText = analysis?.rawScopeText || analysis?.coreScopeText || "";
  if (!rawText || !CARPENTRY_INTENT_REGEX.test(rawText)) {
    return {
      carpentryTradeFamily: "",
      carpentryOperationTags: [],
      carpentryObjectTags: [],
      carpentryScopeBias: [],
      carpentryConfidence: "none",
    };
  }

  // Determine trade family (first match wins; general_carpentry is catch-all)
  let tradeFamily = "";
  let familyExplicit = false;
  for (const { key, patterns } of CARPENTRY_TRADE_FAMILY_PATTERNS) {
    if (key === "general_carpentry") {
      if (!tradeFamily) tradeFamily = key;
      break;
    }
    if (patterns.some((rx) => rx.test(rawText))) {
      tradeFamily = key;
      familyExplicit = true;
      break;
    }
  }

  // Collect operation tags
  const operationTags = [];
  for (const { key, patterns } of CARPENTRY_OPERATION_PATTERNS) {
    if (patterns.some((rx) => rx.test(rawText))) operationTags.push(key);
  }

  // Collect object tags
  const objectTags = [];
  for (const { key, patterns } of CARPENTRY_OBJECT_PATTERNS) {
    if (patterns.some((rx) => rx.test(rawText))) objectTags.push(key);
  }

  // Collect scope bias
  const scopeBias = [];
  for (const { key, patterns } of CARPENTRY_SCOPE_BIAS_PATTERNS) {
    if (patterns.some((rx) => rx.test(rawText))) scopeBias.push(key);
  }

  // Determine confidence
  let confidence;
  if (familyExplicit) {
    confidence = operationTags.length > 0 || objectTags.length > 0 ? "high" : "medium";
  } else {
    confidence = "low";
  }

  return {
    carpentryTradeFamily: tradeFamily,
    carpentryOperationTags: uniqueList(operationTags),
    carpentryObjectTags: uniqueList(objectTags),
    carpentryScopeBias: uniqueList(scopeBias),
    carpentryConfidence: confidence,
  };
}

function resolveFieldSlangMethodHints(analysis = {}) {
  const hints = [];
  if (hasCorpusMatch(analysis, PERIMETER_FLASHING_METHOD_REGEX)) hints.push("perimeter_flashing");
  if (hasCorpusMatch(analysis, JOINT_FINISH_METHOD_REGEX)) hints.push("joint_finish");
  if (hasCorpusMatch(analysis, FLOAT_BLEND_METHOD_REGEX)) hints.push("float_blend");
  if (hasCorpusMatch(analysis, FIT_ADJUST_METHOD_REGEX)) hints.push("fit_adjustment");
  if (hasCorpusMatch(analysis, PENETRATION_SLEEVE_METHOD_REGEX)) hints.push("penetration_sleeve");
  if (hasCorpusMatch(analysis, POST_WRAP_METHOD_REGEX)) hints.push("post_wrap");
  if (hasCorpusMatch(analysis, CLOSURE_CAP_METHOD_REGEX)) hints.push("closure_cap");
  return uniqueList(hints);
}

function resolveVagueContractorIntent(analysis = {}) {
  const perimeterScopeHints = resolvePerimeterScopeHints(analysis);
  const locationContextHints = resolveLocationContextHints(analysis);
  const resetIntent = resolveResetIntent(analysis);
  const partialScopeHints = resolvePartialScopeHints(analysis);
  const openingClosureHints = resolveOpeningClosureHints(analysis);
  const waterDamageRepairHints = resolveWaterDamageRepairHints(analysis);
  const extentLightScopeHints = resolveExtentLightScopeHints(analysis);
  const fieldSlangMethodHints = resolveFieldSlangMethodHints(analysis);
  const conditionDrivenActionAugmentation = resolveConditionDrivenActionAugmentation(analysis);

  return compactAnalysisObject({
    actions: conditionDrivenActionAugmentation.actions,
    actionFamilies: conditionDrivenActionAugmentation.actionFamilies,
    perimeterScopeHints,
    locationContextHints,
    resetIntent,
    partialScopeHints,
    openingClosureHints,
    waterDamageRepairHints,
    extentLightScopeHints,
    fieldSlangMethodHints,
  });
}

function resolveSiteAssemblyHints(analysis = {}) {
  const hints = [];
  if (hasCorpusMatch(analysis, SITE_PERIMETER_ASSEMBLY_REGEX)) hints.push("fence_perimeter_assembly");
  if (hasCorpusMatch(analysis, GATE_ASSEMBLY_REGEX)) hints.push("gate_assembly");
  if (hasCorpusMatch(analysis, RAILING_ASSEMBLY_REGEX)) hints.push("railing_assembly");
  if (hasCorpusMatch(analysis, PANEL_ASSEMBLY_REGEX)) hints.push("panel_assembly");
  return uniqueList(hints);
}

function resolveSecondaryActionMethods(analysis = {}) {
  const methods = [];
  if (hasCorpusMatch(analysis, ROUGH_HOLE_CREATION_REGEX)) methods.push("hole_creation");
  if (hasCorpusMatch(analysis, WELDED_CONNECTION_METHOD_REGEX)) methods.push("welded_connection");
  if (hasCorpusMatch(analysis, ANCHORAGE_METHOD_REGEX)) methods.push("anchorage_connection");
  if (hasCorpusMatch(analysis, PERIMETER_SEAL_METHOD_REGEX)) methods.push("perimeter_seal");
  if (hasCorpusMatch(analysis, WIRE_UP_METHOD_REGEX)) methods.push("electrical_connection");
  if (hasCorpusMatch(analysis, PERIMETER_FLASHING_METHOD_REGEX)) methods.push("perimeter_flashing");
  if (hasCorpusMatch(analysis, JOINT_FINISH_METHOD_REGEX)) methods.push("joint_finish");
  if (hasCorpusMatch(analysis, FLOAT_BLEND_METHOD_REGEX)) methods.push("float_blend");
  if (hasCorpusMatch(analysis, FIT_ADJUST_METHOD_REGEX)) methods.push("fit_adjustment");
  if (hasCorpusMatch(analysis, PENETRATION_SLEEVE_METHOD_REGEX)) methods.push("penetration_sleeve");
  if (hasCorpusMatch(analysis, POST_WRAP_METHOD_REGEX)) methods.push("post_wrap");
  if (hasCorpusMatch(analysis, CLOSURE_CAP_METHOD_REGEX)) methods.push("closure_cap");

  const actions = Array.isArray(analysis?.actions) ? analysis.actions : [];
  if (actions.some((action) => ["patch", "repair"].includes(action)) && actions.includes("paint")) methods.push("repair_then_finish");
  if (actions.includes("paint") && (actions.includes("patch") || actions.includes("repair"))) methods.push("paint_finish_followup");

  return uniqueList(methods);
}

function resolveHoleCreationIntent(analysis = {}) {
  if (!hasCorpusMatch(analysis, ROUGH_HOLE_CREATION_REGEX)) return "";

  const siteHints = Array.isArray(analysis?.siteAssemblyHints) ? analysis.siteAssemblyHints : [];
  const objectType = analysis?.objectType || "";
  const scopeAssetCategory = analysis?.scopeAssetCategory || "";

  if (siteHints.includes("fence_perimeter_assembly")) {
    return "lay out the fence line, locate and mark post positions, and create required post or anchor holes";
  }
  if (siteHints.includes("railing_assembly") || siteHints.includes("gate_assembly") || objectType === "anchored_object" || scopeAssetCategory === "site_hardware") {
    return "locate attachment points and create required post or anchor holes within the stated scope";
  }
  if (["mounted_object", "panel_closure_object", "opening_assembly", "framed_opening_object"].includes(objectType)) {
    return "create required anchor or attachment holes within the stated scope";
  }
  return "complete required drilled or punched attachment holes within the stated scope";
}

function resolveConnectionMethodHints(analysis = {}) {
  const hints = [];
  const objectType = analysis?.objectType || "";
  const connectionModel = analysis?.connectionModel || "";
  const siteHints = Array.isArray(analysis?.siteAssemblyHints) ? analysis.siteAssemblyHints : [];

  if (hasCorpusMatch(analysis, WELDED_CONNECTION_METHOD_REGEX)) {
    if (siteHints.includes("fence_perimeter_assembly")) {
      hints.push("complete welded connections at joints where required");
    } else if (hasCorpusMatch(analysis, /\btabs?\b/i)) {
      hints.push("complete welded tab or attachment connections where required");
    } else {
      hints.push("complete welded connections where required");
    }
  }

  if (
    hasCorpusMatch(analysis, ANCHORAGE_METHOD_REGEX)
    && !["anchored_object", "site_exterior_asset"].includes(objectType)
    && connectionModel !== "anchorage_fasteners"
  ) {
    hints.push("complete required anchorage and securement");
  }

  if (
    hasCorpusMatch(analysis, PERIMETER_SEAL_METHOD_REGEX)
    && connectionModel !== "perimeter_closure"
  ) {
    hints.push("complete sealant or weatherproofing tie-in within the stated scope");
  }

  if (hasCorpusMatch(analysis, PERIMETER_FLASHING_METHOD_REGEX)) {
    hints.push("complete perimeter flashing or weatherproofing tie-in within the stated scope");
  }

  if (
    hasCorpusMatch(analysis, WIRE_UP_METHOD_REGEX)
    && !["electrical_terminations", "utility_service"].includes(connectionModel)
  ) {
    hints.push("complete accessible wiring and connection work within the stated scope");
  }

  if (hasCorpusMatch(analysis, JOINT_FINISH_METHOD_REGEX)) {
    hints.push("complete mud, tape, and finish prep within the stated repair area");
  }
  if (hasCorpusMatch(analysis, FLOAT_BLEND_METHOD_REGEX)) {
    hints.push("float and blend patched surfaces as needed within the stated repair area");
  }
  if (hasCorpusMatch(analysis, FIT_ADJUST_METHOD_REGEX)) {
    hints.push("shim and adjust components for fit as required");
  }
  if (hasCorpusMatch(analysis, PENETRATION_SLEEVE_METHOD_REGEX)) {
    hints.push("complete required sleeve or penetration protection within the stated scope");
  }
  if (hasCorpusMatch(analysis, POST_WRAP_METHOD_REGEX)) {
    hints.push("complete post wrap or trim finish within the stated scope");
  }
  if (hasCorpusMatch(analysis, CLOSURE_CAP_METHOD_REGEX)) {
    hints.push("complete cap or closure tie-in within the stated scope");
  }

  return uniqueList(hints);
}

function resolveRoughContractorIntent(analysis = {}) {
  const siteAssemblyHints = resolveSiteAssemblyHints(analysis);
  const secondaryActionMethods = resolveSecondaryActionMethods(analysis);
  const roughVerbCue = hasCorpusMatch(analysis, /\bput(?:ting)?(?:\s+(?:up|in))?\b|\bredo\b|\btear(?:ing)?\s+out\b|\bframe(?:d|ing)?\s+out\b/i);
  const vagueIntent = resolveVagueContractorIntent(analysis);
  const holeCreationIntent = resolveHoleCreationIntent({
    ...analysis,
    siteAssemblyHints,
  });
  const connectionMethodHints = resolveConnectionMethodHints({
    ...analysis,
    siteAssemblyHints,
  });

  return compactAnalysisObject({
    roughPrompt: Boolean(
      roughVerbCue
      || siteAssemblyHints.length
      || secondaryActionMethods.length
      || (Array.isArray(vagueIntent?.partialScopeHints) && vagueIntent.partialScopeHints.length > 0)
      || (Array.isArray(vagueIntent?.perimeterScopeHints) && vagueIntent.perimeterScopeHints.length > 0)
      || Boolean(vagueIntent?.resetIntent)
      || (Array.isArray(vagueIntent?.waterDamageRepairHints) && vagueIntent.waterDamageRepairHints.length > 0)
      || holeCreationIntent
      || connectionMethodHints.length
    ),
    siteAssemblyHints,
    secondaryActionMethods,
    holeCreationIntent,
    connectionMethodHints,
    perimeterScopeHints: vagueIntent?.perimeterScopeHints,
    locationContextHints: vagueIntent?.locationContextHints,
    resetIntent: vagueIntent?.resetIntent,
    partialScopeHints: vagueIntent?.partialScopeHints,
    openingClosureHints: vagueIntent?.openingClosureHints,
    waterDamageRepairHints: vagueIntent?.waterDamageRepairHints,
    extentLightScopeHints: vagueIntent?.extentLightScopeHints,
    fieldSlangMethodHints: vagueIntent?.fieldSlangMethodHints,
  });
}

function extractUncertaintyPhrases(text) {
  const normalized = normalizeInstructionSpacing(text);
  return uniqueList(
    SAFE_WORDING_SIGNAL_PATTERNS
      .filter((entry) => entry.regex.test(normalized))
      .map((entry) => entry.label)
  );
}

function extractExplicitExclusions(text) {
  const normalized = asText(text).replace(/\r\n?/g, "\n");
  const matches = [];
  EXCLUSION_PATTERNS.forEach((pattern) => {
    let match = pattern.exec(normalized);
    while (match) {
      const phrase = cleanCapturedPhrase(tokenizeWords(match[1]), { keepLeadingQuantity: true });
      if (phrase) matches.push(phrase);
      match = pattern.exec(normalized);
    }
  });
  return uniqueList(matches);
}

function compactAnalysisObject(analysis) {
  return Object.fromEntries(
    Object.entries(analysis).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === "string") return Boolean(value);
      if (value && typeof value === "object") return Object.keys(value).length > 0;
      return value === true;
    })
  );
}

function compactScopeSkeletonCategory(category = {}) {
  return Object.fromEntries(
    Object.entries(category).filter(([, value]) => Array.isArray(value) && value.length > 0)
  );
}

function compactScopeSkeleton(skeleton = {}) {
  return Object.fromEntries(
    Object.entries(skeleton)
      .map(([key, value]) => [key, compactScopeSkeletonCategory(value)])
      .filter(([, value]) => Object.keys(value).length > 0)
  );
}

function mergeScopeSkeletons(baseSkeleton = {}, refineSkeleton = {}) {
  const merged = createScopeSkeleton();
  const skeletons = [baseSkeleton, refineSkeleton].filter((value) => value && typeof value === "object");
  const buckets = ["certain", "implied", "riskyMissing"];

  Object.keys(merged).forEach((category) => {
    buckets.forEach((bucket) => {
      merged[category][bucket] = uniqueList(
        skeletons.flatMap((skeleton) => (
          Array.isArray(skeleton?.[category]?.[bucket]) ? skeleton[category][bucket] : []
        ))
      );
    });
  });

  return compactScopeSkeleton(merged);
}

function normalizeScopeAssistMode(mode) {
  return String(mode || "").trim().toLowerCase() === "refine" ? "refine" : "initial";
}

function createScopeSkeleton() {
  return {
    directWork: { certain: [], implied: [], riskyMissing: [] },
    includedAreas: { certain: [], implied: [], riskyMissing: [] },
    materialsProducts: { certain: [], implied: [], riskyMissing: [] },
    prepRequirements: { certain: [], implied: [], riskyMissing: [] },
    repairsAllowances: { certain: [], implied: [], riskyMissing: [] },
    accessConditions: { certain: [], implied: [], riskyMissing: [] },
    exclusions: { certain: [], implied: [], riskyMissing: [] },
    customerResponsibilities: { certain: [], implied: [], riskyMissing: [] },
    siteConditions: { certain: [], implied: [], riskyMissing: [] },
    completionStandards: { certain: [], implied: [], riskyMissing: [] },
  };
}

function appendSkeletonValues(skeleton, category, bucket, values) {
  if (!skeleton?.[category]?.[bucket]) return;
  skeleton[category][bucket] = uniqueList([
    ...skeleton[category][bucket],
    ...(Array.isArray(values) ? values : [values]),
  ]);
}

function looksLikePaintTarget(text) {
  return /\bhouse\b|\bhome\b|\binterior\b|\bexterior\b|\bbedrooms?\b|\brooms?\b|\bbath(?:room)?\b|\brestroom\b|\bkitchen\b|\boffice\b|\bwalls?\b|\bceilings?\b|\btrim\b|\bdoors?\b|\bbaseboards?\b/i.test(
    asText(text)
  );
}

function hasFinishCarpentryScopeSignals(analysis) {
  const actions = Array.isArray(analysis?.actions) ? analysis.actions : [];
  const installOrReplace = actions.some((action) => ["install", "replace", "remove", "repair", "patch"].includes(action));
  const openingWithSecondaryTrim = hasCorpusMatch(
    analysis,
    /\b(?:man doors?|doors?|windows?|skylights?|roof hatches?|hatches?)\b(?:\s+and\s+trim\b|\b.*\btrim\s+around\b)/i
  );
  if (openingWithSecondaryTrim && hasActionFamily(analysis, "replace_changeout")) return false;
  return installOrReplace && hasCorpusMatch(
    analysis,
    /\bbaseboards?\b|\btrim\b|\bcasing\b|\bcrown(?:\s+mold(?:ing)?)?\b|\bshoe\s*mold(?:ing)?\b|\bfascia\b|\bsoffit trim\b|\bcorner bead\b|\bcap\b|\blower cabinet runs?\b|\bcabinet runs?\b|\bcabinet sections?\b|\bcabinet doors?\b|\bwall cabinets?\b|\bbase cabinets?\b|\bcabinets?\b|\bshelves\b|\bshelf\b|\bshelving\b|\bcasework\b|\bmillwork\b|\bbuilt[-\s]?ins?\b|\blocker units?\b|\bbenches?\b|\bstorage units?\b/i
  );
}

function hasRoofingScopeSignals(analysis = {}) {
  const normalized = sanitizeScopeAssistText(analysis?.coreScopeText || analysis?.rawScopeText);
  if (!normalized) return false;
  if (!/\broof(?:ing)?\b|\bre-?roof\b|\breroof\b|\broofing\s+membrane\b|\broof\s+cover(?:ing|ings?)\b|\bshingles?\b|\bunderlayment\b|\broof\s+deck\b|\broof\s+system\b/i.test(normalized)) return false;
  if (/\bhatch(?:es)?\b|\bopening(?:s)?\b|\baccess\b|\bskylight(?:s)?\b|\bdoor(?:s)?\b|\bwindow(?:s)?\b/i.test(normalized)) return false;
  return true;
}

function resolveFinishCarpentryTargetPhrase(analysis) {
  const preferredObjectPhrase = resolvePreferredObjectPhrase(analysis);
  const partialScopeHints = Array.isArray(analysis?.partialScopeHints) ? analysis.partialScopeHints : [];
  const candidates = uniqueList([
    ...(Array.isArray(analysis?.items) ? analysis.items : []),
    ...(Array.isArray(analysis?.quantityItemPairs) ? analysis.quantityItemPairs : []),
    ...(Array.isArray(analysis?.actionItemPhrases) ? analysis.actionItemPhrases : []),
    preferredObjectPhrase,
  ]).filter(Boolean);
  if (partialScopeHints.includes("run_scope")) {
    const runCandidate = candidates.find((value) => /\blower cabinet runs?\b|\bcabinet runs?\b/i.test(value));
    if (runCandidate) return normalizeTargetPhrase(runCandidate) || "cabinet run";
  }
  const primary = candidates.find((value) =>
    collectPatternLabels(FINISH_CARPENTRY_PATTERNS, value).length > 0
  ) || pickPreferredTargetCandidate(candidates) || "trim components";
  return normalizeTargetPhrase(primary) || "trim components";
}

function hasCorpusMatch(analysis, regex) {
  const corpus = uniqueList([
    analysis?.rawScopeText,
    analysis?.coreScopeText,
    ...(Array.isArray(analysis?.actionItemPhrases) ? analysis.actionItemPhrases : []),
    ...(Array.isArray(analysis?.items) ? analysis.items : []),
    ...(Array.isArray(analysis?.quantityItemPairs) ? analysis.quantityItemPairs : []),
    ...(Array.isArray(analysis?.locations) ? analysis.locations : []),
  ]).join(" ");
  return regex.test(corpus);
}

function resolveActionFamilies(analysis = {}) {
  const explicitFamilies = Array.isArray(analysis?.actionFamilies) ? analysis.actionFamilies : [];
  const familiesFromActions = uniqueList(
    (Array.isArray(analysis?.actions) ? analysis.actions : [])
      .map((action) => ACTION_FAMILY_BY_CANONICAL[action])
      .filter(Boolean)
  );
  const familiesFromText = analysis?.coreScopeText ? extractActionFamilies(analysis.coreScopeText) : [];
  return uniqueList([...explicitFamilies, ...familiesFromActions, ...familiesFromText]);
}

function hasActionFamily(analysis = {}, family = "") {
  if (!family) return false;
  return resolveActionFamilies(analysis).includes(family);
}

function resolvePrimaryActionFamily(analysis = {}) {
  const families = resolveActionFamilies(analysis);
  if (families.includes("replace_changeout")) return "replace_changeout";
  return families[0] || "";
}

function hasSiteLightingAssetMatch(analysis = {}) {
  return hasCorpusMatch(analysis, SITE_LIGHTING_ASSET_REGEX);
}

function hasMountedSiteAssetMatch(analysis = {}) {
  return hasCorpusMatch(analysis, SITE_ASSET_REGEX);
}

function hasSiteEnvironmentMatch(analysis = {}) {
  return hasCorpusMatch(analysis, SITE_ENVIRONMENT_REGEX);
}

function hasSiteEquipmentScopeSignals(analysis = {}) {
  const actionCue = hasActionFamily(analysis, "remove_demo")
    || hasActionFamily(analysis, "replace_changeout")
    || hasActionFamily(analysis, "install_add_mount")
    || hasCorpusMatch(analysis, /\bremove existing\b|\breplace existing\b|\binstall new\b/i);

  return actionCue && (
    hasSiteLightingAssetMatch(analysis)
    || hasMountedSiteAssetMatch(analysis)
  );
}

function hasReplaceableAssetActionCue(analysis = {}) {
  return hasActionFamily(analysis, "remove_demo")
    || hasActionFamily(analysis, "replace_changeout")
    || hasActionFamily(analysis, "install_add_mount")
    || hasCorpusMatch(analysis, REPLACEABLE_ASSET_ACTION_REGEX);
}

function resolveExactScopeAssetCategory(analysis = {}) {
  if (
    hasCorpusMatch(analysis, PERIMETER_ACCESSORY_OBJECT_REGEX)
    && hasCorpusMatch(analysis, PERIMETER_SEAL_METHOD_REGEX)
    && hasCorpusMatch(analysis, OPENING_PERIMETER_OBJECT_REGEX)
  ) {
    return "door_hardware";
  }
  if (hasCorpusMatch(analysis, DOOR_HARDWARE_ASSET_REGEX)) {
    return "door_hardware";
  }
  if (hasCorpusMatch(analysis, /\bglass\b/i) && hasCorpusMatch(analysis, /\bstorefront\b/i)) return "glazing_storefront";
  if (hasCorpusMatch(analysis, INTERIOR_BUILTIN_ASSET_REGEX)) return "interior_builtin";
  if (hasCorpusMatch(analysis, PLUMBING_FIXTURE_ASSET_REGEX)) return "plumbing_fixture";
  if (hasCorpusMatch(analysis, PLUMBING_EQUIPMENT_ASSET_REGEX)) return "plumbing_equipment";
  if (hasCorpusMatch(analysis, MECHANICAL_EQUIPMENT_ASSET_REGEX)) return "mechanical_equipment";
  if (hasCorpusMatch(analysis, FINISH_SURFACE_ASSET_REGEX)) return "finish_surface";
  if (hasCorpusMatch(analysis, ELECTRICAL_EQUIPMENT_ASSET_REGEX)) return "electrical_equipment";
  if (hasCorpusMatch(analysis, GLAZING_STOREFRONT_ASSET_REGEX)) return "glazing_storefront";
  if (hasCorpusMatch(analysis, REPAIR_SURFACE_ASSET_REGEX)) return "repair_surface";
  if (hasCorpusMatch(analysis, DOOR_HARDWARE_ASSET_REGEX)) return "door_hardware";
  if (hasCorpusMatch(analysis, SITE_HARDWARE_ASSET_REGEX)) return "site_hardware";
  if (hasCorpusMatch(analysis, GENERAL_EQUIPMENT_ASSET_REGEX)) return "general_equipment";
  return "";
}

function resolveAssetFamily(analysis = {}) {
  const category = analysis?.scopeAssetCategory || resolveExactScopeAssetCategory(analysis);
  if (category && ASSET_FAMILY_BY_CATEGORY[category]) return ASSET_FAMILY_BY_CATEGORY[category];
  if (hasCorpusMatch(analysis, STOREFRONT_OPENING_FAMILY_REGEX)) return "storefront_glazing_opening";
  if (hasCorpusMatch(analysis, FINISH_MATERIAL_FAMILY_REGEX)) return "finish_material_surface";
  if (
    hasCorpusMatch(analysis, FRAMED_OPENING_OBJECT_REGEX)
    || hasCorpusMatch(analysis, OPENING_ASSEMBLY_OBJECT_REGEX)
    || hasCorpusMatch(analysis, PANEL_CLOSURE_OBJECT_REGEX)
    || hasCorpusMatch(analysis, TRIM_ACCESSORY_OBJECT_REGEX)
  ) {
    return "";
  }
  if (hasCorpusMatch(analysis, REPAIR_DAMAGE_FAMILY_REGEX)) return "repair_surface_damage";
  if (analysis?.siteEquipmentScope || hasCorpusMatch(analysis, SITE_HARDWARE_ASSET_REGEX)) {
    return "site_exterior_asset";
  }
  if (hasCorpusMatch(analysis, NON_CONNECTED_ASSET_FAMILY_REGEX)) return "non_connected_hardware_asset";
  if (hasCorpusMatch(analysis, CONNECTED_EQUIPMENT_FAMILY_REGEX)) return "connected_equipment_fixture";
  return "";
}

function resolveScopeAssetCategory(analysis = {}) {
  const exactCategory = resolveExactScopeAssetCategory(analysis);
  if (exactCategory) return exactCategory;

  const assetFamily = resolveAssetFamily(analysis);
  if (assetFamily === "interior_builtin_casework") return "interior_builtin";
  if (assetFamily === "storefront_glazing_opening") return "glazing_storefront";
  if (assetFamily === "finish_material_surface") return "finish_surface";
  if (assetFamily === "repair_surface_damage") return "repair_surface";
  if (assetFamily === "site_exterior_asset") return "site_hardware";
  if (assetFamily === "non_connected_hardware_asset") return "site_hardware";
  if (assetFamily === "connected_equipment_fixture") {
    if (hasCorpusMatch(analysis, /\bwater heaters?\b|\btankless water heaters?\b/i)) return "plumbing_equipment";
    if (hasCorpusMatch(analysis, /\btoilet(?:s)?\b|\bsinks?\b|\bfaucets?\b|\bdrinking fountains?\b|\bmop sinks?\b|\bplumbing fixtures?\b/i)) return "plumbing_fixture";
    if (hasCorpusMatch(analysis, /\bexhaust fans?\b|\brestroom fans?\b|\bvent fans?\b|\brooftop fans?\b|\brooftop units?\b|\brtu\b|\bcondensers?\b|\bair handlers?\b|\bmini[\s-]?splits?\b/i)) {
      return "mechanical_equipment";
    }
    if (hasCorpusMatch(analysis, /\bdisconnect(?:s)?\b|\bbreakers?\b|\bpanels?\b|\blight fixtures?\b|\blighting fixtures?\b|\bhigh[-\s]?bay(?:\s+light(?:ing)?)?\s+fixtures?\b|\bpole lights?\b|\blight poles?\b/i)) {
      return "electrical_equipment";
    }
    return "general_equipment";
  }

  return "";
}

function resolveObjectType(analysis = {}) {
  const category = analysis?.scopeAssetCategory || resolveScopeAssetCategory(analysis);
  const openingWithSecondaryTrim = hasCorpusMatch(
    analysis,
    /\b(?:man doors?|doors?|windows?|skylights?|roof hatches?|hatches?)\b(?:\s+and\s+trim\b|\b.*\btrim\s+around\b)/i
  );
  const framePerimeterScope = hasCorpusMatch(analysis, FRAME_PERIMETER_OBJECT_REGEX)
    && (hasCorpusMatch(analysis, PERIMETER_SEAL_METHOD_REGEX) || hasCorpusMatch(analysis, PERIMETER_ACCESSORY_OBJECT_REGEX));
  const lowLevelMinorComponentScope = hasCorpusMatch(analysis, MINOR_HARDWARE_COMPONENT_REGEX)
    && !hasCorpusMatch(analysis, /\bcover panels?\b|\baccess panels?\b/i);
  const lowLevelCoverPanelScope = hasCorpusMatch(analysis, /\bcover panels?\b|\bcover panel\b|\bpanel covers?\b/i)
    && !hasCorpusMatch(analysis, /\baccess panels?\b|\bglazing panels?\b|\bwall panels?\b|\bcanopy panels?\b|\bopening\b/i);

  if (category === "interior_builtin") return "built_in_assembly";
  if (category === "plumbing_equipment" || category === "mechanical_equipment" || category === "electrical_equipment" || category === "general_equipment") {
    return "equipment_unit";
  }
  if (category === "plumbing_fixture") return "fixture_device";
  if (category === "glazing_storefront") return "framed_opening_object";
  if (category === "finish_surface") return "finish_material_surface";
  if (category === "repair_surface") return "repair_area";
  if (category === "door_hardware") return "hardware_component";

  if (openingWithSecondaryTrim && hasCorpusMatch(analysis, FRAMED_OPENING_OBJECT_REGEX)) {
    return "framed_opening_object";
  }
  if (framePerimeterScope) return "framed_opening_object";
  if (
    hasCorpusMatch(analysis, PERIMETER_ACCESSORY_OBJECT_REGEX)
    && !hasCorpusMatch(analysis, OPENING_PERIMETER_OBJECT_REGEX)
  ) {
    return "hardware_component";
  }
  if (hasCorpusMatch(analysis, LOW_LEVEL_TRIM_COMPONENT_REGEX)) return "trim_accessory_object";
  if (
    lowLevelCoverPanelScope
    && !hasCorpusMatch(analysis, SITE_COMPONENT_CONTEXT_REGEX)
    && !hasSiteExteriorScopeSignals(analysis)
  ) {
    return "hardware_component";
  }
  if (
    lowLevelMinorComponentScope
    && !hasCorpusMatch(analysis, SITE_COMPONENT_CONTEXT_REGEX)
    && !hasSiteExteriorScopeSignals(analysis)
  ) {
    return "hardware_component";
  }
  if (hasCorpusMatch(analysis, TRIM_ACCESSORY_OBJECT_REGEX) && !hasCorpusMatch(analysis, /\bstorefront hardware\b|\bdoor hardware\b/i)) {
    return "trim_accessory_object";
  }
  if (hasCorpusMatch(analysis, PANEL_CLOSURE_OBJECT_REGEX) && !hasCorpusMatch(analysis, /\bpanelboards?\b|\bdistribution panels?\b|\bcontrol panels?\b/i)) {
    return "panel_closure_object";
  }
  if (
    hasCorpusMatch(analysis, MINOR_HARDWARE_COMPONENT_REGEX)
    && !hasCorpusMatch(analysis, SITE_COMPONENT_CONTEXT_REGEX)
    && !hasSiteExteriorScopeSignals(analysis)
  ) {
    return "hardware_component";
  }
  if (hasCorpusMatch(analysis, FRAMED_OPENING_OBJECT_REGEX)) return "framed_opening_object";
  if (hasCorpusMatch(analysis, OPENING_ASSEMBLY_OBJECT_REGEX)) return "opening_assembly";
  if (hasCorpusMatch(analysis, ANCHORED_ASSEMBLY_OBJECT_REGEX)) return "anchored_object";
  if (hasCorpusMatch(analysis, MOUNTED_ASSEMBLY_OBJECT_REGEX)) return "mounted_object";
  if (category === "site_hardware") return "site_exterior_asset";
  if (hasCorpusMatch(analysis, SITE_HARDWARE_ASSET_REGEX) || hasSiteExteriorScopeSignals(analysis)) return "site_exterior_asset";
  if (hasCorpusMatch(analysis, /\bcomponents?\b|\bhardware\b|\btrim\b|\baccessory\b/i)) return "hardware_component";

  return "";
}

function resolveConnectionModel(analysis = {}) {
  const category = analysis?.scopeAssetCategory || resolveScopeAssetCategory(analysis);
  const objectType = analysis?.objectType || resolveObjectType({ ...analysis, scopeAssetCategory: category });

  if (category === "plumbing_fixture" || category === "plumbing_equipment") return "water_gas_drain_vent";
  if (category === "electrical_equipment") return "electrical_terminations";
  if (category === "mechanical_equipment" || category === "general_equipment") return "utility_service";
  if (objectType === "built_in_assembly") return "anchorage_fasteners";
  if (
    hasCorpusMatch(analysis, PERIMETER_ACCESSORY_OBJECT_REGEX)
    || (objectType === "hardware_component" && hasCorpusMatch(analysis, /\bdoor sweeps?\b|\bsweeps?\b|\bthresholds?\b/i))
  ) {
    return "perimeter_closure";
  }
  if (objectType === "framed_opening_object" || objectType === "opening_assembly" || objectType === "panel_closure_object" || hasCorpusMatch(analysis, OPENING_PERIMETER_OBJECT_REGEX)) {
    return "perimeter_closure";
  }
  if (objectType === "trim_accessory_object") {
    return hasCorpusMatch(analysis, /\bflashing\b/i) ? "perimeter_closure" : "finish_only_attachment";
  }
  if (objectType === "anchored_object" || objectType === "mounted_object" || objectType === "site_exterior_asset" || objectType === "hardware_component") {
    return "anchorage_fasteners";
  }

  return "no_clear_connection_type";
}

function resolveAssemblyScale(analysis = {}) {
  const objectType = analysis?.objectType || resolveObjectType(analysis);

  if (objectType === "repair_area") return "localized_repair_area";
  if (objectType === "finish_material_surface") return "surface_material_system";
  if (objectType === "built_in_assembly") return "fixture_device";
  if (objectType === "framed_opening_object" || objectType === "opening_assembly") return "full_assembly_opening";
  if (objectType === "site_exterior_asset" || objectType === "anchored_object" || objectType === "mounted_object") return "site_exterior_assembly";
  if (objectType === "equipment_unit") return "full_assembly_opening";
  if (objectType === "fixture_device") return "fixture_device";
  return "small_hardware_component";
}

function resolveBoundaryRiskHints(analysis = {}) {
  const objectType = analysis?.objectType || resolveObjectType(analysis);
  const connectionModel = analysis?.connectionModel || resolveConnectionModel({ ...analysis, objectType });
  const hints = [];

  if (analysis?.riskAwareInput || hasCorpusMatch(analysis, DAMAGED_OBJECT_CONTEXT_REGEX)) hints.push("concealed_damage");
  if (connectionModel === "perimeter_closure" || hasCorpusMatch(analysis, WEATHER_CLOSURE_OBJECT_REGEX)) hints.push("perimeter_closure");
  if (objectType === "framed_opening_object" || objectType === "opening_assembly" || objectType === "panel_closure_object") {
    hints.push("framing_structural_correction");
    hints.push("finish_repair");
  }
  if (objectType === "trim_accessory_object") {
    hints.push("substrate_issues");
    hints.push("finish_repair");
  }
  if (objectType === "built_in_assembly") {
    hints.push("substrate_issues");
    hints.push("finish_repair");
  }
  if (objectType === "anchored_object" || objectType === "mounted_object" || objectType === "site_exterior_asset") {
    hints.push("anchorage_correction");
    hints.push("finish_repair");
  }
  if (analysis?.siteExteriorContext && (objectType === "anchored_object" || objectType === "site_exterior_asset")) {
    hints.push("concrete_base_restoration");
  }
  if (connectionModel === "water_gas_drain_vent" || connectionModel === "electrical_terminations" || connectionModel === "utility_service") {
    hints.push("utility_service_upgrades");
    hints.push("code_upgrades");
  }
  if (hasCorpusMatch(analysis, /\bstorefront\b/i)) hints.push("public_opening_protection");

  return uniqueList(hints);
}

function hasStrongNamedFamilyMatch(analysis = {}) {
  const category = analysis?.scopeAssetCategory || resolveScopeAssetCategory(analysis);
  const workBucket = analysis?.scopeWorkBucket || resolveScopeWorkBucket(analysis);
  const objectType = analysis?.objectType || resolveObjectType({ ...analysis, scopeAssetCategory: category });

  if (hasTechnicalScopeSignals(analysis)) return true;
  if (workBucket === "finish_coating" && hasCorpusMatch(analysis, FINISH_SURFACE_ASSET_REGEX)) return true;
  if (workBucket === "repair_patch" && hasCorpusMatch(analysis, REPAIR_SURFACE_ASSET_REGEX)) return true;
  if (hasFinishCarpentryScopeSignals(analysis)) return true;
  if (hasCorpusMatch(analysis, /\btoilet(?:s)?\b/i)) return true;
  if (hasCorpusMatch(analysis, /\bvanity\b/i) && !hasCorpusMatch(analysis, /\bfaucet\b|\bsink\b|\bsupply lines?\b|\bdrain\b/i)) return true;
  if (hasCorpusMatch(analysis, /\bowner[-\s]?supplied\b|\bcustomer[-\s]?supplied\b|\b(?:vanity\s+)?faucet(?:s)?\b|\bsink\b|\bplumbing fixtures?\b/i)) {
    return true;
  }
  if (hasRoofingScopeSignals(analysis)) return true;
  if (hasCorpusMatch(analysis, DOOR_HARDWARE_ASSET_REGEX) && objectType === "hardware_component") return true;
  if (hasCorpusMatch(analysis, SITE_HARDWARE_ASSET_REGEX) && (analysis?.siteExteriorContext || analysis?.siteEquipmentScope)) return true;
  if (hasReplaceableAssetScopeSignals(analysis) && (objectType || category)) return true;

  return false;
}

function isConnectedAssetCategory(category = "") {
  return CONNECTED_ASSET_CATEGORIES.has(String(category || "").trim());
}

function resolveReplaceableAssetCategory(analysis = {}) {
  if (!hasReplaceableAssetActionCue(analysis)) return "";
  const category = resolveScopeAssetCategory(analysis);
  if (["finish_surface", "repair_surface"].includes(category)) return "";
  return category;
}

function hasFinishCoatingScopeSignals(analysis = {}) {
  return hasActionFamily(analysis, "finish_coating")
    || hasCorpusMatch(analysis, /\b(?:re)?paint(?:ed|ing)?\b|\bprime(?:d|ing)?\b|\bcoating\b/i)
    || hasCorpusMatch(analysis, FINISH_SURFACE_ASSET_REGEX);
}

function hasRepairPatchScopeSignals(analysis = {}) {
  return hasActionFamily(analysis, "repair_patch")
    || hasCorpusMatch(analysis, REPAIR_SURFACE_ASSET_REGEX);
}

function resolveCommercialContextSignals(analysis = {}) {
  const corpus = uniqueList([
    analysis?.coreScopeText,
    ...(Array.isArray(analysis?.items) ? analysis.items : []),
    ...(Array.isArray(analysis?.locations) ? analysis.locations : []),
    ...(Array.isArray(analysis?.actionItemPhrases) ? analysis.actionItemPhrases : []),
  ]).join(" ");

  return uniqueList(
    COMMERCIAL_CONTEXT_PATTERNS
      .filter((entry) => entry.regex.test(corpus))
      .map((entry) => entry.label)
  );
}

function hasSiteExteriorScopeSignals(analysis = {}) {
  const actionCue = hasActionFamily(analysis, "remove_demo")
    || hasActionFamily(analysis, "replace_changeout")
    || hasActionFamily(analysis, "install_add_mount")
    || hasActionFamily(analysis, "repair_patch")
    || hasCorpusMatch(analysis, /\bremove(?: and replace)?\b|\breplace\b|\binstall\b|\bdemo\b|\brepair\b/i);

  return actionCue && (
    analysis?.siteEquipmentScope
    || hasSiteLightingAssetMatch(analysis)
    || hasMountedSiteAssetMatch(analysis)
    || hasCorpusMatch(analysis, SITE_HARDWARE_ASSET_REGEX)
    || hasCorpusMatch(analysis, SITE_EXTERIOR_CONTEXT_REGEX)
  );
}

function resolveImpliedAccessContext(analysis = {}) {
  if (hasCorpusMatch(analysis, ROOFTOP_ACCESS_IMPLIED_REGEX)) return "rooftop_access";
  if (
    analysis?.siteEquipmentScope
    || hasSiteLightingAssetMatch(analysis)
    || hasCorpusMatch(analysis, LIFT_ACCESS_IMPLIED_REGEX)
  ) {
    return "lift_access";
  }
  if (hasCorpusMatch(analysis, SAFE_HANDLING_ACCESS_IMPLIED_REGEX)) return "safe_handling";
  return "";
}

function resolveScopeTradeBucket(analysis = {}) {
  const category = analysis?.scopeAssetCategory || resolveScopeAssetCategory(analysis);
  const assetFamily = analysis?.scopeAssetFamily || resolveAssetFamily({ ...analysis, scopeAssetCategory: category });
  const objectType = analysis?.objectType || resolveObjectType({ ...analysis, scopeAssetCategory: category, scopeAssetFamily: assetFamily });
  const signals = uniqueList(analysis?.technicalSignals || []);

  if (signals.some((signal) => ["disconnect work", "circuit breaker work", "conduit work", "panel work", "site lighting equipment"].includes(signal))) {
    return "electrical";
  }
  if (signals.some((signal) => ["rooftop equipment", "controls"].includes(signal))) return "mechanical";
  if (signals.some((signal) => ["process tubing", "process lines", "welding", "orbital welding", "instrumentation"].includes(signal))) {
    return "specialty";
  }
  if (category === "interior_builtin") return "finish_carpentry";
  if (category === "plumbing_fixture" || category === "plumbing_equipment") return "plumbing";
  if (category === "mechanical_equipment") return "mechanical";
  if (category === "electrical_equipment") return "electrical";
  if (category === "glazing_storefront") return "glazing";
  if (category === "finish_surface" || hasFinishCoatingScopeSignals(analysis)) return "finish";
  if (category === "repair_surface") {
    if (hasCorpusMatch(analysis, /\bstucco\b|\bcurbs?\b/i)) return "site_finish";
    return "repair";
  }
  if (category === "door_hardware") return "hardware";
  if (category === "site_hardware" || hasSiteExteriorScopeSignals(analysis)) return "site";

  if (assetFamily === "connected_equipment_fixture") return "general";
  if (assetFamily === "interior_builtin_casework") return "finish_carpentry";
  if (assetFamily === "non_connected_hardware_asset") return "hardware";
  if (assetFamily === "site_exterior_asset") return "site";
  if (assetFamily === "finish_material_surface") return "finish";
  if (assetFamily === "repair_surface_damage") return "repair";
  if (assetFamily === "storefront_glazing_opening") return "glazing";
  if (objectType === "framed_opening_object" || objectType === "opening_assembly" || objectType === "panel_closure_object") return "openings";
  if (objectType === "hardware_component") return analysis?.siteExteriorContext ? "site" : "hardware";
  if (objectType === "trim_accessory_object") return analysis?.siteExteriorContext ? "exterior_finish" : "finish_carpentry";
  if (objectType === "anchored_object" || objectType === "mounted_object" || objectType === "site_exterior_asset") return "site";

  return "";
}

function resolveScopeWorkBucket(analysis = {}) {
  const actionFamilies = resolveActionFamilies(analysis);
  const category = analysis?.scopeAssetCategory || resolveScopeAssetCategory(analysis);
  const assetFamily = analysis?.scopeAssetFamily || resolveAssetFamily({ ...analysis, scopeAssetCategory: category });
  const objectType = analysis?.objectType || resolveObjectType({ ...analysis, scopeAssetCategory: category });
  const perimeterScopeHints = Array.isArray(analysis?.perimeterScopeHints) ? analysis.perimeterScopeHints : [];
  const replacementScope = actionFamilies.includes("replace_changeout")
    || hasCorpusMatch(analysis, /\bremove(?:d|ing)?(?:\s+and)?\s+replace(?:d|ing)?\b|\bremove\/replace\b/i);
  const removalScope = actionFamilies.includes("remove_demo") && !replacementScope;
  const installScope = actionFamilies.includes("install_add_mount") && !replacementScope && !removalScope;
  const repairScope = hasRepairPatchScopeSignals(analysis);
  const finishScope = hasFinishCoatingScopeSignals(analysis);
  const repairFinishChain = repairScope
    && finishScope
    && !hasCorpusMatch(analysis, /\b(?:re)?paint(?:ed|ing)?\b|\bprime(?:d|ing)?\b|\bcoat(?:ed|ing)?\b|\bseal(?:ed|ing)?\b|\bcaulk(?:ed|ing)?\b|\bcaulking\b/i);
  const securementRepairScope = repairScope
    && installScope
    && !replacementScope
    && !hasCorpusMatch(analysis, /\binstall(?:ed|ing)?\b|\bnew\b|\bfurnish(?:ed|ing)?\s+and\s+install\b|\bprovide(?:d|ing)?\s+and\s+install\b|\bmount(?:ed|ing)?\b|\bset(?:ting)?\b|\bput(?:ting)?(?:\s+(?:up|in))\b/i)
    && hasCorpusMatch(analysis, /\btighten(?:ed|ing)?\b|\b(?:re)?secure(?:d|ing)?\b|\bfasten(?:ed|ing)?\s+off\b|\banchor(?:ed|ing)?(?:\s+(?:it|them)\s+down)?\b|\bbolt(?:ed|ing)?(?:\s+(?:it|them|back))?\s+up\b/i);
  const secondaryFinishFollowupScope = finishScope
    && (replacementScope || installScope || removalScope)
    && !hasCorpusMatch(analysis, /\b(?:re)?paint(?:ed|ing)?\b|\bprime(?:d|ing)?\b|\bcoat(?:ed|ing)?\b/i)
    && (
      perimeterScopeHints.length > 0
      || hasMidLevelAdjacentMakeGoodScope(analysis)
      || hasMidLevelPerimeterFollowupScope(analysis)
      || hasMidLevelFinishFollowupScope(analysis)
    );

  if ((repairScope && !replacementScope && !installScope && !finishScope) || repairFinishChain || securementRepairScope) return "repair_patch";
  if (finishScope && !secondaryFinishFollowupScope) return "finish_coating";
  if (replacementScope && (isConnectedAssetCategory(category) || assetFamily === "connected_equipment_fixture" || analysis?.siteEquipmentScope)) return "replace_connected_equipment";
  if (replacementScope && (category || assetFamily || objectType || hasSiteExteriorScopeSignals(analysis))) return "replace_non_connected_asset";
  if (removalScope && (category || assetFamily || objectType || hasSiteExteriorScopeSignals(analysis) || analysis?.siteEquipmentScope)) return "demo_remove";
  if (installScope && (category || assetFamily || objectType || hasSiteExteriorScopeSignals(analysis) || analysis?.siteEquipmentScope)) return "install_new_asset";
  if (analysis?.siteEquipmentScope && replacementScope) return "replace_connected_equipment";
  return "";
}

function resolveContextModifiers(analysis = {}) {
  const residentialContext = hasCorpusMatch(analysis, RESIDENTIAL_CONTEXT_REGEX);
  const conditionModifiers = uniqueList([
    hasCorpusMatch(analysis, /\bexisting\b/i) ? "existing" : "",
    hasCorpusMatch(analysis, /\bnew\b/i) ? "new" : "",
    hasCorpusMatch(analysis, DAMAGED_OBJECT_CONTEXT_REGEX) ? "damaged_or_failed" : "",
    residentialContext ? "residential" : "",
  ].filter(Boolean));

  return {
    commercialContextSignals: resolveCommercialContextSignals(analysis),
    siteExteriorContext: hasSiteExteriorScopeSignals(analysis),
    impliedAccessContext: resolveImpliedAccessContext(analysis),
    residentialContext,
    conditionModifiers,
  };
}

function hasReplaceableAssetScopeSignals(analysis = {}) {
  return Boolean(resolveReplaceableAssetCategory(analysis));
}

function getTechnicalSubtypeFlags(analysis = {}) {
  const signals = uniqueList(analysis?.technicalSignals || []);
  return {
    breakerScope: signals.includes("circuit breaker work"),
    disconnectScope: signals.includes("disconnect work"),
    conduitScope: signals.includes("conduit work"),
    rooftopScope: signals.includes("rooftop equipment"),
    tenantImprovementScope: signals.includes("tenant improvement"),
    siteLightingScope: signals.includes("site lighting equipment") || hasSiteLightingAssetMatch(analysis),
    siteAssetScope: signals.includes("site asset work") || hasMountedSiteAssetMatch(analysis),
    siteEquipmentScope: hasSiteEquipmentScopeSignals(analysis),
    poleMountedSiteAssetScope: hasCorpusMatch(analysis, POLE_MOUNTED_SITE_ASSET_REGEX),
    hospitalityContext: hasCorpusMatch(analysis, /\bhotel\b|\bresort\b/i),
    commercialSiteContext: hasSiteEnvironmentMatch(analysis) || hasCorpusMatch(analysis, /\bcommercial\b|\bhotel\b|\bparking lot\b|\bcampus\b|\bproperty\b|\boutdoor\b/i),
    panelScope: signals.includes("panel work") || signals.includes("instrumentation") || signals.includes("tie-in"),
    tubingScope: signals.some((signal) => ["process tubing", "process lines", "welding", "orbital welding"].includes(signal)),
    electricalCommercialScope: signals.some((signal) => ELECTRICAL_COMMERCIAL_TECHNICAL_SIGNALS.has(signal)),
  };
}

function buildDetectedWorkPhrases(analysis) {
  const actionItemPhrases = Array.isArray(analysis?.actionItemPhrases) ? analysis.actionItemPhrases : [];
  if (actionItemPhrases.length) return actionItemPhrases;

  const actions = Array.isArray(analysis?.actions) ? analysis.actions : [];
  const quantityItemPairs = Array.isArray(analysis?.quantityItemPairs) ? analysis.quantityItemPairs : [];
  const items = Array.isArray(analysis?.items) ? analysis.items : [];
  if (actions.length && quantityItemPairs.length) {
    return uniqueList(quantityItemPairs.map((pair) => `${actions[0]} ${pair}`));
  }
  if (actions.length && items.length) {
    return uniqueList(items.map((item) => `${actions[0]} ${item}`));
  }
  return uniqueList([analysis?.coreScopeText]);
}

function buildRepairAllowanceHints(analysis) {
  const allowances = [];
  const actions = Array.isArray(analysis?.actions) ? analysis.actions : [];
  const uncertaintyPhrases = Array.isArray(analysis?.uncertaintyPhrases) ? analysis.uncertaintyPhrases : [];
  const primaryQualifier = uncertaintyPhrases.find((value) =>
    ["as needed", "if needed", "if required", "as required", "where required", "where needed"].includes(value)
  );

  if (actions.includes("patch") && primaryQualifier) allowances.push(`patch ${primaryQualifier}`);
  if (actions.includes("repair") && primaryQualifier) allowances.push(`repair ${primaryQualifier}`);
  if (actions.includes("patch") && hasCorpusMatch(analysis, /\bdrywall\b/i)) allowances.push("minor patching only");
  return uniqueList(allowances);
}

function buildScopeSkeleton(rawText, analysis) {
  const skeleton = createScopeSkeleton();
  const normalizedRawText = asText(rawText).trim();
  const scopeText = analysis?.coreScopeText || normalizedRawText;
  const explicitExclusions = extractExplicitExclusions(scopeText);
  const actions = Array.isArray(analysis?.actions) ? analysis.actions : [];
  const technicalFlags = getTechnicalSubtypeFlags(analysis);
  const scopeAssetCategory = analysis?.scopeAssetCategory || resolveScopeAssetCategory(analysis);
  const scopeWorkBucket = analysis?.scopeWorkBucket || resolveScopeWorkBucket({ ...analysis, scopeAssetCategory });
  const replaceableAssetCategory = resolveReplaceableAssetCategory(analysis);
  const replaceableAssetScope = Boolean(replaceableAssetCategory);
  const impliesPainting = actions.includes("paint") || actions.includes("prime") || hasCorpusMatch(analysis, /\b(?:re)?paint(?:ed|ing)?\b|\bprime(?:d|ing)?\b/i);
  const technicalScope = hasTechnicalScopeSignals(analysis);
  const impliesFixtureInstall = hasCorpusMatch(analysis, /\btoilet(?:s)?\b|\b(?:vanity\s+)?faucet(?:s)?\b|\bvanity\b|\bsink\b|\bplumbing fixtures?\b|\bshutoff(?:s)?\b/i);
  const impliesDrywallPatch = hasCorpusMatch(analysis, /\bdrywall\b|\bwall repair\b|\btexture\b/i);
  const impliesFinishCarpentry = hasFinishCarpentryScopeSignals(analysis);
  const impliesToiletReplacement = hasCorpusMatch(analysis, /\btoilet(?:s)?\b/i);
  const impliesFaucetScope = hasCorpusMatch(analysis, /\b(?:vanity\s+)?faucet(?:s)?\b|\bfaucet(?:s)?\b/i);
  const ownerSuppliedScope = hasCorpusMatch(analysis, /\bowner[-\s]?supplied\b|\bcustomer[-\s]?supplied\b/i);
  const vanityOnlyScope = hasCorpusMatch(analysis, /\bvanity\b/i) && !hasCorpusMatch(analysis, /\bfaucet\b|\bsink\b|\bsupply lines?\b|\bdrain\b/i);
  const paintAreaHints = collectPatternLabels(PAINT_TARGET_PATTERNS, scopeText);
  const filteredItems = uniqueList(
    (Array.isArray(analysis?.items) ? analysis.items : []).filter((item) => !(impliesPainting && looksLikePaintTarget(item)))
  );
  const secondaryActionMethods = Array.isArray(analysis?.secondaryActionMethods) ? analysis.secondaryActionMethods : [];
  const connectionMethodHints = Array.isArray(analysis?.connectionMethodHints) ? analysis.connectionMethodHints : [];
  const holeCreationIntent = normalizeScopePhrase(analysis?.holeCreationIntent || "");
  const siteAssemblyHints = Array.isArray(analysis?.siteAssemblyHints) ? analysis.siteAssemblyHints : [];
  const perimeterScopeHints = Array.isArray(analysis?.perimeterScopeHints) ? analysis.perimeterScopeHints : [];
  const partialScopeHints = Array.isArray(analysis?.partialScopeHints) ? analysis.partialScopeHints : [];
  const openingClosureHints = Array.isArray(analysis?.openingClosureHints) ? analysis.openingClosureHints : [];
  const resetIntent = String(analysis?.resetIntent || "").trim();
  const waterDamageRepairHints = Array.isArray(analysis?.waterDamageRepairHints) ? analysis.waterDamageRepairHints : [];

  appendSkeletonValues(skeleton, "directWork", "certain", buildDetectedWorkPhrases(analysis));
  appendSkeletonValues(skeleton, "includedAreas", "certain", uniqueList([
    ...(Array.isArray(analysis?.locations) ? analysis.locations : []),
    ...collectPatternLabels(AREA_SIGNAL_PATTERNS, scopeText),
    ...(impliesPainting ? paintAreaHints : []),
  ]));
  appendSkeletonValues(skeleton, "materialsProducts", "certain", filteredItems);
  appendSkeletonValues(skeleton, "prepRequirements", "certain", collectPatternLabels(PREP_SIGNAL_PATTERNS, scopeText));
  appendSkeletonValues(skeleton, "repairsAllowances", "certain", buildRepairAllowanceHints(analysis));
  appendSkeletonValues(skeleton, "accessConditions", "certain", collectPatternLabels(ACCESS_SIGNAL_PATTERNS, normalizedRawText));
  appendSkeletonValues(skeleton, "exclusions", "certain", explicitExclusions);
  appendSkeletonValues(skeleton, "customerResponsibilities", "certain", collectPatternLabels(CUSTOMER_RESPONSIBILITY_PATTERNS, normalizedRawText));
  appendSkeletonValues(skeleton, "siteConditions", "certain", collectPatternLabels(SITE_CONDITION_PATTERNS, normalizedRawText));
  appendSkeletonValues(skeleton, "completionStandards", "certain", collectPatternLabels(COMPLETION_SIGNAL_PATTERNS, normalizedRawText));
  if (holeCreationIntent) {
    appendSkeletonValues(skeleton, "prepRequirements", "implied", [holeCreationIntent]);
  }
  if (connectionMethodHints.length) {
    appendSkeletonValues(skeleton, "directWork", "implied", connectionMethodHints);
  }
  if (resetIntent) {
    appendSkeletonValues(skeleton, "directWork", "implied", [
      "temporarily remove, protect, and reinstall the described item within the stated scope as required",
    ]);
    appendSkeletonValues(skeleton, "completionStandards", "implied", [
      "verify fit, attachment, and securement after reinstall",
    ]);
  }
  if (perimeterScopeHints.length) {
    appendSkeletonValues(skeleton, "prepRequirements", "implied", ["prepare adjacent perimeter surfaces and transitions as needed"]);
  }
  if (partialScopeHints.length) {
    appendSkeletonValues(skeleton, "includedAreas", "implied", ["affected section, side, edge, or stated work area only"]);
  }
  if (openingClosureHints.includes("opening_closure")) {
    appendSkeletonValues(skeleton, "directWork", "implied", ["complete closure, patching, or finish tie-in required for the described opening scope"]);
  }
  if (waterDamageRepairHints.length) {
    appendSkeletonValues(skeleton, "repairsAllowances", "implied", ["localized repair of visible leak- or moisture-damaged areas only"]);
  }
  const patchAroundAccess = Boolean(
    analysis?.mentionsPatchOrRepair
    && ((Array.isArray(analysis?.locations) && analysis.locations.some((location) => /\baccess\b/i.test(location)))
      || hasCorpusMatch(analysis, /\baround plumbing access\b|\baround access\b/i))
  );

  if (impliesPainting) {
    const primaryCommercialContext = resolvePrimaryCommercialContext(analysis);
    appendSkeletonValues(skeleton, "prepRequirements", "implied", ["prepare designated surfaces as needed", "protect adjacent areas"]);
    appendSkeletonValues(skeleton, "completionStandards", "implied", ["minor masking and cleanup"]);
    appendSkeletonValues(
      skeleton,
      "exclusions",
      "riskyMissing",
      [
        primaryCommercialContext
          ? "extensive surface repair, concealed damage, and surfaces outside the identified work area are not included unless identified and approved"
          : "extensive surface repair, concealed damage, and surfaces outside the agreed work area are not included unless identified and approved",
      ]
    );
  }

  if (technicalScope) {
    if (technicalFlags.siteEquipmentScope) {
      const removalOnlyScope = (actions.includes("remove") || actions.includes("demo")) && !actions.includes("replace");
      const replacementScope = actions.includes("replace");
      const installationOnlyScope = actions.includes("install") && !replacementScope;

      appendSkeletonValues(
        skeleton,
        "accessConditions",
        "implied",
        technicalFlags.poleMountedSiteAssetScope
          ? ["coordinate lift or suitable access equipment as required"]
          : ["coordinate access equipment as required"]
      );
      appendSkeletonValues(
        skeleton,
        "directWork",
        "implied",
        replacementScope
          ? [
            technicalFlags.siteLightingScope
              ? "disconnect and reconnect accessible site-lighting conductors or attachments required for the replacement"
              : "disconnect and reconnect accessible services or attachments required for the replacement",
          ]
          : (removalOnlyScope
            ? [
              technicalFlags.siteLightingScope
                ? "disconnect accessible site-lighting conductors or attachments required for safe removal"
                : "disconnect accessible services or attachments required for safe removal",
            ]
            : [])
      );
      appendSkeletonValues(
        skeleton,
        "completionStandards",
        "implied",
        replacementScope
          ? ["set and secure the replacement assembly", "verify operation where applicable", "clean up work area"]
          : (installationOnlyScope
            ? ["set and secure the described assembly", "verify operation where applicable", "clean up work area"]
            : ["remove debris and dispose of removed materials", "clean up work area"])
      );
      appendSkeletonValues(
        skeleton,
        "exclusions",
        "riskyMissing",
        replacementScope || installationOnlyScope
          ? ["base or foundation repair, underground wiring repairs, utility/service changes, and work beyond accessible site connections are not included unless identified and approved"]
          : ["base or foundation removal, underground wiring repairs, utility/service changes, and work beyond accessible disconnect points are not included unless identified and approved"]
      );
    } else if (technicalFlags.electricalCommercialScope) {
      if (technicalFlags.conduitScope) {
        appendSkeletonValues(skeleton, "directWork", "implied", ["install required bends, supports, and terminations"]);
        appendSkeletonValues(skeleton, "completionStandards", "implied", ["leave conduit run ready for follow-on electrical work", "clean up work area"]);
        appendSkeletonValues(
          skeleton,
          "exclusions",
          "riskyMissing",
          ["wire pull, device terminations, major demolition, and work outside the identified conduit route are not included unless identified and approved"]
        );
      } else {
        appendSkeletonValues(
          skeleton,
          "directWork",
          "implied",
          technicalFlags.disconnectScope
            ? ["reconnect accessible conductors required for the disconnect replacement"]
            : ["complete accessible terminations and identification as required"]
        );
        appendSkeletonValues(skeleton, "completionStandards", "implied", ["verify operation and clean up work area"]);
        appendSkeletonValues(
          skeleton,
          "exclusions",
          "riskyMissing",
          technicalFlags.disconnectScope
            ? ["conductors beyond accessible disconnect terminations, equipment repairs, and unforeseen code-driven upgrades are not included unless identified and approved"]
            : ["panel modifications beyond the identified breaker scope, feeder changes, and unforeseen code-driven upgrades are not included unless identified and approved"]
        );
      }
    } else {
      appendSkeletonValues(skeleton, "prepRequirements", "implied", ["fit-up and align accessible runs as required"]);
      appendSkeletonValues(skeleton, "completionStandards", "implied", ["complete work within the stated work area"]);
      appendSkeletonValues(
        skeleton,
        "exclusions",
        "riskyMissing",
        ["specialty QA/QC requirements, testing, shutdown coordination, and work outside the stated limits are not included unless specifically identified and approved"]
      );
    }
  }

  if (scopeWorkBucket === "repair_patch" && !technicalScope && !impliesDrywallPatch) {
    const repairPlan = resolveRepairScopePlan(analysis);
    appendSkeletonValues(skeleton, "directWork", "implied", repairPlan.directWorkHints);
    appendSkeletonValues(skeleton, "completionStandards", "implied", repairPlan.completionHints);
    appendSkeletonValues(skeleton, "exclusions", "riskyMissing", [repairPlan.exclusion]);
  }

  if (scopeWorkBucket === "finish_coating" && !technicalScope && !impliesPainting && scopeAssetCategory === "finish_surface") {
    const finishPlan = resolveFinishScopePlan(analysis);
    appendSkeletonValues(skeleton, "directWork", "implied", finishPlan.directWorkHints);
    appendSkeletonValues(skeleton, "completionStandards", "implied", finishPlan.completionHints);
    appendSkeletonValues(skeleton, "exclusions", "riskyMissing", [finishPlan.exclusion]);
  }

  if (scopeWorkBucket && EXPANSION_WORK_BUCKETS.has(scopeWorkBucket) && !technicalScope) {
    const accessCoordinationPhrase = resolveAccessCoordinationPhrase(analysis);
    if (accessCoordinationPhrase) {
      appendSkeletonValues(skeleton, "accessConditions", "implied", [decapitalizePhrase(accessCoordinationPhrase)]);
    }
  }

  if (siteAssemblyHints.includes("fence_perimeter_assembly")) {
    appendSkeletonValues(skeleton, "directWork", "implied", ["set and align fence posts or supports as required", "install fence sections within the stated fence line"]);
    appendSkeletonValues(skeleton, "completionStandards", "implied", ["verify attachment, alignment, and continuity of the fence assembly", "remove incidental installation debris"]);
    appendSkeletonValues(
      skeleton,
      "exclusions",
      "riskyMissing",
      ["concealed obstructions, utility conflicts, major grade correction, and work beyond the stated fence limits are not included unless identified and approved"]
    );
  }

  if (
    replaceableAssetScope
    && !technicalScope
    && !impliesToiletReplacement
    && !impliesFixtureInstall
    && !impliesFinishCarpentry
  ) {
    const assetPlan = resolveReplaceableAssetScopePlan(analysis, replaceableAssetCategory);
    appendSkeletonValues(skeleton, "directWork", "implied", assetPlan.directWorkHints);
    appendSkeletonValues(skeleton, "completionStandards", "implied", assetPlan.completionHints);
    appendSkeletonValues(skeleton, "exclusions", "riskyMissing", [assetPlan.exclusion]);
  }

  if (impliesFinishCarpentry) {
    appendSkeletonValues(skeleton, "directWork", "implied", ["fit and secure trim components as needed"]);
    appendSkeletonValues(skeleton, "prepRequirements", "implied", ["make minor cuts and adjustments for fit"]);
    appendSkeletonValues(skeleton, "completionStandards", "implied", ["clean up work area"]);
    appendSkeletonValues(
      skeleton,
      "exclusions",
      "riskyMissing",
      ["wall repair beyond minor touch-up, floor repair, and final paint or stain touch-up are not included unless identified and approved"]
    );
  }

  if (impliesToiletReplacement) {
    appendSkeletonValues(skeleton, "materialsProducts", "implied", ["wax rings", "closet bolts"]);
    appendSkeletonValues(skeleton, "directWork", "implied", ["reconnect supply lines"]);
    appendSkeletonValues(skeleton, "completionStandards", "implied", ["test for proper operation", "clean up work area"]);
    appendSkeletonValues(
      skeleton,
      "exclusions",
      "riskyMissing",
      ["flange repair, shutoff replacement, concealed damage, and code-related corrections are not included unless identified and approved"]
    );
  }

  if (impliesFaucetScope) {
    appendSkeletonValues(skeleton, "directWork", "implied", ["reconnect supply lines"]);
    appendSkeletonValues(skeleton, "completionStandards", "implied", ["test for leaks and proper operation", "clean up work area"]);
  }

  if (impliesDrywallPatch) {
    appendSkeletonValues(skeleton, "prepRequirements", "implied", ["sand smooth"]);
    appendSkeletonValues(skeleton, "completionStandards", "implied", ["leave ready for finish"]);
    appendSkeletonValues(skeleton, "repairsAllowances", "implied", ["minor patching only"]);
    appendSkeletonValues(
      skeleton,
      "exclusions",
      "riskyMissing",
      ["extensive drywall replacement, texture matching, and concealed damage repairs are not included unless identified and approved"]
    );
  }

  if (patchAroundAccess) {
    appendSkeletonValues(skeleton, "repairsAllowances", "implied", ["patch affected areas where required after access work"]);
    appendSkeletonValues(skeleton, "accessConditions", "implied", ["accessible work areas only"]);
  }

  if (secondaryActionMethods.includes("repair_then_finish") || secondaryActionMethods.includes("paint_finish_followup")) {
    appendSkeletonValues(skeleton, "directWork", "implied", ["patch affected wall areas as required"]);
    appendSkeletonValues(skeleton, "completionStandards", "implied", ["apply finish or paint within the stated work area", "clean up work area"]);
  }

  if (impliesFixtureInstall) {
    appendSkeletonValues(skeleton, "completionStandards", "implied", ["clean up work area"]);
    if (vanityOnlyScope) {
      appendSkeletonValues(skeleton, "directWork", "implied", ["fit and secure as needed"]);
      appendSkeletonValues(
        skeleton,
        "exclusions",
        "riskyMissing",
        ["plumbing reconnection, wall or floor repair, and concealed damage are not included unless identified and approved"]
      );
    } else if (!impliesToiletReplacement && !impliesFaucetScope) {
      appendSkeletonValues(skeleton, "completionStandards", "implied", ["test for proper operation"]);
    }
  }

  if ((Array.isArray(analysis?.actions) ? analysis.actions : []).includes("demo") || (Array.isArray(analysis?.actions) ? analysis.actions : []).includes("remove")) {
    appendSkeletonValues(skeleton, "completionStandards", "implied", ["remove debris"]);
  }

  if (ownerSuppliedScope) {
    appendSkeletonValues(skeleton, "customerResponsibilities", "certain", ["owner-supplied items"]);
  }

  if (hasRiskAwareScopeSignals(analysis)) {
    appendSkeletonValues(
      skeleton,
      "siteConditions",
      "riskyMissing",
      ["additional concealed or existing-condition work is not included unless identified and approved"]
    );
  }

  return compactScopeSkeleton(skeleton);
}

export function analyzeScopeAssistInput(userInput) {
  const rawText = asText(userInput).trim();
  if (!rawText) return {};

  const formattingIntent = detectFormattingIntent(rawText);
  const brevityIntent = detectBrevityIntent(rawText);
  const rewriteIntents = detectRewriteIntents(rawText);
  const expandRequested = detectExpandRequested(rawText);
  const coreScopeText = stripInstructionPhrases(rawText) || rawText;
  const baseActions = extractActionVerbs(coreScopeText);
  const baseActionFamilies = extractActionFamilies(coreScopeText);
  const roughActionAugmentation = resolveRoughActionAugmentation({
    coreScopeText,
    actions: baseActions,
    actionFamilies: baseActionFamilies,
  });
  let actions = roughActionAugmentation.actions;
  let actionFamilies = roughActionAugmentation.actionFamilies;
  const quantities = extractQuantities(coreScopeText);
  const quantityItemPairs = extractQuantityItemPairs(coreScopeText);
  const actionItemPhrases = extractActionItemPairs(coreScopeText);
  const items = uniqueList([
    ...quantityItemPairs.map((value) => value.replace(/^\S+\s+/, "")),
    ...extractItemsFromActions(coreScopeText),
  ]);
  const locations = extractLocations(coreScopeText);
  const uncertaintyPhrases = extractUncertaintyPhrases(rawText);
  const riskTriggerTerms = extractRiskTriggerTerms(rawText);
  const rawTechnicalSignals = extractTechnicalSignals(coreScopeText || rawText);
  const safeWordingRequested = detectSafeWordingRequested(rawText);
  const mentionsDisposal = DISPOSAL_REGEX.test(rawText);
  const mentionsPatchOrRepair = PATCH_REPAIR_REGEX.test(rawText);
  const preliminaryClassificationSeed = {
    coreScopeText,
    actions,
    actionFamilies,
    quantityItemPairs,
    actionItemPhrases,
    items,
    locations,
    technicalSignals: rawTechnicalSignals,
  };
  const preliminaryScopeAssetCategory = resolveScopeAssetCategory(preliminaryClassificationSeed);
  const preliminaryScopeAssetFamily = resolveAssetFamily({
    ...preliminaryClassificationSeed,
    scopeAssetCategory: preliminaryScopeAssetCategory,
  });
  const preliminaryObjectType = resolveObjectType({
    ...preliminaryClassificationSeed,
    scopeAssetCategory: preliminaryScopeAssetCategory,
    scopeAssetFamily: preliminaryScopeAssetFamily,
  });
  const preliminaryConnectionModel = resolveConnectionModel({
    ...preliminaryClassificationSeed,
    scopeAssetCategory: preliminaryScopeAssetCategory,
    scopeAssetFamily: preliminaryScopeAssetFamily,
    objectType: preliminaryObjectType,
  });
  const vagueContractorIntent = resolveVagueContractorIntent({
    ...preliminaryClassificationSeed,
    scopeAssetCategory: preliminaryScopeAssetCategory,
    scopeAssetFamily: preliminaryScopeAssetFamily,
    objectType: preliminaryObjectType,
    connectionModel: preliminaryConnectionModel,
  });
  actions = uniqueList([...(vagueContractorIntent?.actions || actions), ...actions]);
  actionFamilies = uniqueList([...(vagueContractorIntent?.actionFamilies || actionFamilies), ...actionFamilies]);

  const classificationSeed = {
    coreScopeText,
    actions,
    actionFamilies,
    quantityItemPairs,
    actionItemPhrases,
    items,
    locations,
    technicalSignals: rawTechnicalSignals,
  };
  const siteEquipmentScope = hasSiteEquipmentScopeSignals(classificationSeed);
  const scopeAssetCategory = resolveScopeAssetCategory(classificationSeed);
  const scopeAssetFamily = resolveAssetFamily({
    ...classificationSeed,
    scopeAssetCategory,
    siteEquipmentScope,
  });
  const objectType = resolveObjectType({
    ...classificationSeed,
    scopeAssetCategory,
    scopeAssetFamily,
    siteEquipmentScope,
  });
  const replaceableAssetCategory = resolveReplaceableAssetCategory(classificationSeed);
  const replaceableAssetScope = Boolean(replaceableAssetCategory);
  const primaryActionFamily = resolvePrimaryActionFamily({
    ...classificationSeed,
    scopeAssetCategory,
    scopeAssetFamily,
  });
  const {
    commercialContextSignals,
    siteExteriorContext,
    impliedAccessContext,
    residentialContext,
    conditionModifiers,
  } = resolveContextModifiers({
    ...classificationSeed,
    scopeAssetCategory,
    scopeAssetFamily,
    objectType,
    siteEquipmentScope,
  });
  const connectionModel = resolveConnectionModel({
    ...classificationSeed,
    scopeAssetCategory,
    scopeAssetFamily,
    objectType,
    siteEquipmentScope,
  });
  const roughContractorIntent = resolveRoughContractorIntent({
    ...classificationSeed,
    scopeAssetCategory,
    scopeAssetFamily,
    objectType,
    connectionModel,
  });
  const technicalSignals = resolveFilteredTechnicalSignals({
    ...classificationSeed,
    scopeAssetCategory,
    scopeAssetFamily,
    objectType,
    connectionModel,
    technicalSignals: rawTechnicalSignals,
    roughPrompt: roughContractorIntent?.roughPrompt,
    siteAssemblyHints: roughContractorIntent?.siteAssemblyHints,
    secondaryActionMethods: roughContractorIntent?.secondaryActionMethods,
    perimeterScopeHints: roughContractorIntent?.perimeterScopeHints,
    locationContextHints: roughContractorIntent?.locationContextHints,
    resetIntent: roughContractorIntent?.resetIntent,
    partialScopeHints: roughContractorIntent?.partialScopeHints,
    openingClosureHints: roughContractorIntent?.openingClosureHints,
    waterDamageRepairHints: roughContractorIntent?.waterDamageRepairHints,
    extentLightScopeHints: roughContractorIntent?.extentLightScopeHints,
    fieldSlangMethodHints: roughContractorIntent?.fieldSlangMethodHints,
  });
  const filteredClassificationSeed = {
    ...classificationSeed,
    technicalSignals,
  };
  const assemblyScale = resolveAssemblyScale({
    ...filteredClassificationSeed,
    scopeAssetCategory,
    objectType,
  });
  const boundaryRiskHints = resolveBoundaryRiskHints({
    ...filteredClassificationSeed,
    scopeAssetCategory,
    scopeAssetFamily,
    objectType,
    connectionModel,
    siteExteriorContext,
    riskAwareInput: riskTriggerTerms.length > 0,
  });
  const scopeTradeBucket = resolveScopeTradeBucket({
    ...filteredClassificationSeed,
    scopeAssetCategory,
    scopeAssetFamily,
    objectType,
    siteEquipmentScope,
    siteExteriorContext,
  });
  const scopeWorkBucket = resolveScopeWorkBucket({
    ...filteredClassificationSeed,
    scopeAssetCategory,
    scopeAssetFamily,
    objectType,
    siteEquipmentScope,
  });
  const inputShape = analyzeScopeInputShape({
    coreScopeText,
    actions,
    quantities,
    quantityItemPairs,
    actionItemPhrases,
    locations,
    uncertaintyPhrases,
    technicalSignals,
  });
  const detailLevel = resolveScopeDetailLevel({
    coreScopeText,
    actions,
    items,
    riskTriggerTerms,
    technicalSignals,
  });
  const technicalScopeCompleteness = resolveTechnicalScopeCompleteness({
    coreScopeText,
    actions,
    items,
    quantityItemPairs,
    actionItemPhrases,
    locations,
    technicalSignals,
    inputShape,
  });
  const expansionPressure = resolveScopeExpansionPressure({
    detailLevel,
    formattingIntent,
    brevityIntent,
    expandRequested,
    inputShape,
    technicalScopeCompleteness,
    replaceableAssetScope,
    scopeWorkBucket,
    scopeAssetCategory,
    siteExteriorContext,
    commercialContextSignals,
    impliedAccessContext,
  });
  const scopeDepthTarget = resolveScopeDepthTarget(detailLevel, {
    technicalScopeCompleteness,
    expandRequested,
    inputShape,
    scopeWorkBucket,
    scopeAssetCategory,
  });
  const analysis = {
    rawScopeText: rawText,
    coreScopeText: coreScopeText !== rawText ? coreScopeText : "",
    actions,
    actionFamilies,
    primaryActionFamily,
    quantities,
    quantityItemPairs,
    actionItemPhrases,
    items,
    locations,
    technicalSignals,
    inputShape,
    detailLevel,
    technicalScopeCompleteness,
    expansionPressure,
    scopeDepthTarget,
    rewriteIntents,
    formattingIntent,
    brevityIntent,
    expandRequested,
    safeWordingRequested,
    uncertaintyPhrases,
    riskTriggerTerms,
    riskAwareInput: safeWordingRequested || riskTriggerTerms.length > 0,
    mentionsDisposal,
    mentionsPatchOrRepair,
    siteEquipmentScope,
    siteExteriorContext,
    commercialContextSignals,
    impliedAccessContext,
    residentialContext,
    conditionModifiers,
    roughPrompt: roughContractorIntent?.roughPrompt,
    siteAssemblyHints: roughContractorIntent?.siteAssemblyHints,
    secondaryActionMethods: roughContractorIntent?.secondaryActionMethods,
    holeCreationIntent: roughContractorIntent?.holeCreationIntent,
    connectionMethodHints: roughContractorIntent?.connectionMethodHints,
    perimeterScopeHints: roughContractorIntent?.perimeterScopeHints,
    locationContextHints: roughContractorIntent?.locationContextHints,
    resetIntent: roughContractorIntent?.resetIntent,
    partialScopeHints: roughContractorIntent?.partialScopeHints,
    openingClosureHints: roughContractorIntent?.openingClosureHints,
    waterDamageRepairHints: roughContractorIntent?.waterDamageRepairHints,
    extentLightScopeHints: roughContractorIntent?.extentLightScopeHints,
    fieldSlangMethodHints: roughContractorIntent?.fieldSlangMethodHints,
    replaceableAssetScope,
    replaceableAssetCategory,
    scopeAssetCategory,
    scopeAssetFamily,
    objectType,
    connectionModel,
    assemblyScale,
    boundaryRiskHints,
    scopeTradeBucket,
    scopeWorkBucket,
  };
  const scopeSkeleton = buildScopeSkeleton(rawText, analysis);
  const scopeProfile = resolveScopeProfile({ ...analysis, scopeSkeleton });
  const midBandAmbiguityResult = resolveMidBandAmbiguityControl(analysis);
  const referentialFollowUpHints = resolveReferentialFollowUpHints(analysis);
  const demonstrativeModifierHints = resolveDemonstrativeModifierHints(analysis);
  const multiAnchorResult = resolveMultiAnchorSeparationHints(analysis);
  const relativeZoneResult = resolveRelativeZoneHints(analysis);
  const multiZoneResult = resolveMultiZoneChainHints(analysis);
  const coverageExtentResult = resolveCoverageExtentHints(analysis);
  const ordinalCountStackedResult = resolveOrdinalCountStackedHints(analysis);
  const rangePositionalFractionalResult = resolveRangePositionalFractionalHints(analysis);
  const anchorCarrySubzoneResult = resolveAnchorCarrySubzoneHints(analysis);
  const coordinatedDistributionResult = resolveCoordinatedDistributionHints(analysis);
  const weldingNormResult = resolveWeldingNormalization(analysis);
  const ironworkNormResult = resolveIronworkNormalization(analysis);
  const carpentryNormResult = resolveCarpentryNormalization(analysis);

  return compactAnalysisObject({
    ...analysis,
    scopeExpansionActive: expandRequested || actions.length > 0 || riskTriggerTerms.length > 0,
    scopeSkeleton,
    scopeProfile,
    midBandAmbiguity: midBandAmbiguityResult.midBandAmbiguity || false,
    midBandBiasPhrasing: midBandAmbiguityResult.midBandBiasPhrasing || "",
    hasStrongClause: midBandAmbiguityResult.hasStrongClause || false,
    hasWeakClause: midBandAmbiguityResult.hasWeakClause || false,
    referentialFollowUpHints,
    demonstrativeModifierHints,
    multiAnchorSeparationActive: multiAnchorResult.multiAnchorSeparationActive || false,
    relativeZoneHints: relativeZoneResult.relativeZoneHints,
    relativeZoneSeparationActive: relativeZoneResult.relativeZoneSeparationActive || false,
    multiZoneChainHints: multiZoneResult.multiZoneChainHints,
    multiZoneChainActive: multiZoneResult.multiZoneChainActive || false,
    coverageExtentHints: coverageExtentResult.coverageExtentHints,
    coverageExtentActive: coverageExtentResult.coverageExtentActive || false,
    ordinalCountStackedHints: ordinalCountStackedResult.ordinalCountStackedHints,
    ordinalCountStackedActive: ordinalCountStackedResult.ordinalCountStackedActive || false,
    rangePositionalFractionalHints: rangePositionalFractionalResult.rangePositionalFractionalHints,
    rangePositionalFractionalActive: rangePositionalFractionalResult.rangePositionalFractionalActive || false,
    anchorCarrySubzoneHints: anchorCarrySubzoneResult.anchorCarrySubzoneHints,
    anchorCarrySubzoneActive: anchorCarrySubzoneResult.anchorCarrySubzoneActive || false,
    coordinatedDistributionHints: coordinatedDistributionResult.coordinatedDistributionHints,
    coordinatedDistributionActive: coordinatedDistributionResult.coordinatedDistributionActive || false,
    weldingBaseProcess: weldingNormResult.weldingBaseProcess,
    weldingSecondaryTags: weldingNormResult.weldingSecondaryTags,
    weldingMaterialContext: weldingNormResult.weldingMaterialContext,
    weldingScopeBias: weldingNormResult.weldingScopeBias,
    weldingConfidence: weldingNormResult.weldingConfidence,
    weldingRelatedNotWelding: weldingNormResult.weldingRelatedNotWelding,
    ironworkTradeFamily: ironworkNormResult.ironworkTradeFamily,
    ironworkOperationTags: ironworkNormResult.ironworkOperationTags,
    ironworkObjectTags: ironworkNormResult.ironworkObjectTags,
    ironworkScopeBias: ironworkNormResult.ironworkScopeBias,
    ironworkConfidence: ironworkNormResult.ironworkConfidence,
    carpentryTradeFamily: carpentryNormResult.carpentryTradeFamily,
    carpentryOperationTags: carpentryNormResult.carpentryOperationTags,
    carpentryObjectTags: carpentryNormResult.carpentryObjectTags,
    carpentryScopeBias: carpentryNormResult.carpentryScopeBias,
    carpentryConfidence: carpentryNormResult.carpentryConfidence,
  });
}

function resolveFilteredTechnicalSignals(analysis = {}) {
  const signals = uniqueList(analysis?.technicalSignals || []);
  if (!signals.length) return [];

  const methodOnlyWelding = signals.every((signal) => signal === "welding")
    && (
      Boolean(analysis?.roughPrompt)
      || (Array.isArray(analysis?.secondaryActionMethods) && analysis.secondaryActionMethods.includes("welded_connection"))
    )
    && (
      ["site_hardware", "glazing_storefront", "door_hardware"].includes(analysis?.scopeAssetCategory)
      || ["anchored_object", "mounted_object", "panel_closure_object", "opening_assembly", "framed_opening_object", "trim_accessory_object", "hardware_component", "site_exterior_asset"].includes(analysis?.objectType)
      || (Array.isArray(analysis?.siteAssemblyHints) && analysis.siteAssemblyHints.length > 0)
    );

  if (!methodOnlyWelding) return signals;
  return signals.filter((signal) => signal !== "welding");
}

function mergeScopeAssistAnalyses(baseAnalysis = {}, refineAnalysis = {}, { formatIntent = "" } = {}) {
  const base = baseAnalysis && typeof baseAnalysis === "object" ? baseAnalysis : {};
  const refine = refineAnalysis && typeof refineAnalysis === "object" ? refineAnalysis : {};
  const mergedFormattingIntent = formatIntent || refine.formattingIntent || base.formattingIntent || "";
  const mergedBrevityIntent = refine.brevityIntent || base.brevityIntent || "";
  const mergedExpandRequested = Boolean(base.expandRequested || refine.expandRequested);
  const mergedDetailLevel = base.detailLevel || refine.detailLevel || "";
  const mergedInputShape = (base.inputShape && typeof base.inputShape === "object" && Object.keys(base.inputShape).length)
    ? base.inputShape
    : (refine.inputShape || {});
  const mergedTechnicalScopeCompleteness = base.technicalScopeCompleteness || refine.technicalScopeCompleteness || "";
  const mergedScopeSkeleton = mergeScopeSkeletons(base.scopeSkeleton, refine.scopeSkeleton);
  const mergedCommercialContextSignals = uniqueList([...(base.commercialContextSignals || []), ...(refine.commercialContextSignals || [])]);
  const mergedSiteExteriorContext = Boolean(base.siteExteriorContext || refine.siteExteriorContext);
  const mergedImpliedAccessContext = base.impliedAccessContext || refine.impliedAccessContext || "";
  const mergedResidentialContext = Boolean(base.residentialContext || refine.residentialContext);
  const mergedConditionModifiers = uniqueList([...(base.conditionModifiers || []), ...(refine.conditionModifiers || [])]);
  const mergedScopeAssetCategory = base.scopeAssetCategory || refine.scopeAssetCategory || "";
  const mergedScopeAssetFamily = base.scopeAssetFamily || refine.scopeAssetFamily || "";
  const mergedObjectType = base.objectType || refine.objectType || "";
  const mergedConnectionModel = base.connectionModel || refine.connectionModel || "";
  const mergedAssemblyScale = base.assemblyScale || refine.assemblyScale || "";
  const mergedBoundaryRiskHints = uniqueList([...(base.boundaryRiskHints || []), ...(refine.boundaryRiskHints || [])]);
  const mergedRoughPrompt = Boolean(base.roughPrompt || refine.roughPrompt);
  const mergedSiteAssemblyHints = uniqueList([...(base.siteAssemblyHints || []), ...(refine.siteAssemblyHints || [])]);
  const mergedSecondaryActionMethods = uniqueList([...(base.secondaryActionMethods || []), ...(refine.secondaryActionMethods || [])]);
  const mergedConnectionMethodHints = uniqueList([...(base.connectionMethodHints || []), ...(refine.connectionMethodHints || [])]);
  const mergedHoleCreationIntent = base.holeCreationIntent || refine.holeCreationIntent || "";
  const mergedPerimeterScopeHints = uniqueList([...(base.perimeterScopeHints || []), ...(refine.perimeterScopeHints || [])]);
  const mergedLocationContextHints = uniqueList([...(base.locationContextHints || []), ...(refine.locationContextHints || [])]);
  const mergedResetIntent = refine.resetIntent || base.resetIntent || "";
  const mergedPartialScopeHints = uniqueList([...(base.partialScopeHints || []), ...(refine.partialScopeHints || [])]);
  const mergedOpeningClosureHints = uniqueList([...(base.openingClosureHints || []), ...(refine.openingClosureHints || [])]);
  const mergedWaterDamageRepairHints = uniqueList([...(base.waterDamageRepairHints || []), ...(refine.waterDamageRepairHints || [])]);
  const mergedExtentLightScopeHints = uniqueList([...(base.extentLightScopeHints || []), ...(refine.extentLightScopeHints || [])]);
  const mergedFieldSlangMethodHints = uniqueList([...(base.fieldSlangMethodHints || []), ...(refine.fieldSlangMethodHints || [])]);
  const mergedScopeWorkBucket = base.scopeWorkBucket || refine.scopeWorkBucket || "";
  const mergedScopeTradeBucket = base.scopeTradeBucket || refine.scopeTradeBucket || "";
  const mergedExpansionPressure = resolveScopeExpansionPressure({
    detailLevel: mergedDetailLevel,
    formattingIntent: mergedFormattingIntent,
    brevityIntent: mergedBrevityIntent,
    expandRequested: mergedExpandRequested,
    inputShape: mergedInputShape,
    technicalScopeCompleteness: mergedTechnicalScopeCompleteness,
    replaceableAssetScope: Boolean(base.replaceableAssetScope || refine.replaceableAssetScope),
    scopeWorkBucket: mergedScopeWorkBucket,
    scopeAssetCategory: mergedScopeAssetCategory,
    siteExteriorContext: mergedSiteExteriorContext,
    commercialContextSignals: mergedCommercialContextSignals,
    impliedAccessContext: mergedImpliedAccessContext,
  });
  const mergedScopeDepthTarget = resolveScopeDepthTarget(mergedDetailLevel, {
    technicalScopeCompleteness: mergedTechnicalScopeCompleteness,
    expandRequested: mergedExpandRequested,
    inputShape: mergedInputShape,
    scopeWorkBucket: mergedScopeWorkBucket,
    scopeAssetCategory: mergedScopeAssetCategory,
  });

  return compactAnalysisObject({
    ...base,
    rawScopeText: base.rawScopeText || refine.rawScopeText || "",
    actions: uniqueList([...(base.actions || []), ...(refine.actions || [])]),
    actionFamilies: uniqueList([...(base.actionFamilies || []), ...(refine.actionFamilies || [])]),
    primaryActionFamily: base.primaryActionFamily || refine.primaryActionFamily || "",
    quantities: uniqueList(base.quantities || []),
    quantityItemPairs: uniqueList(base.quantityItemPairs || []),
    actionItemPhrases: uniqueList([...(base.actionItemPhrases || []), ...(refine.actionItemPhrases || [])]),
    items: uniqueList([...(base.items || []), ...(refine.items || [])]),
    locations: uniqueList([...(base.locations || []), ...(refine.locations || [])]),
    technicalSignals: uniqueList([...(base.technicalSignals || []), ...(refine.technicalSignals || [])]),
    rewriteIntents: uniqueList([...(base.rewriteIntents || []), ...(refine.rewriteIntents || [])]),
    formattingIntent: mergedFormattingIntent,
    brevityIntent: mergedBrevityIntent,
    expandRequested: mergedExpandRequested,
    safeWordingRequested: Boolean(base.safeWordingRequested || refine.safeWordingRequested),
    uncertaintyPhrases: uniqueList([...(base.uncertaintyPhrases || []), ...(refine.uncertaintyPhrases || [])]),
    riskTriggerTerms: uniqueList([...(base.riskTriggerTerms || []), ...(refine.riskTriggerTerms || [])]),
    riskAwareInput: Boolean(base.riskAwareInput || refine.riskAwareInput),
    mentionsDisposal: Boolean(base.mentionsDisposal || refine.mentionsDisposal),
    mentionsPatchOrRepair: Boolean(base.mentionsPatchOrRepair || refine.mentionsPatchOrRepair),
    siteEquipmentScope: Boolean(base.siteEquipmentScope || refine.siteEquipmentScope),
    siteExteriorContext: mergedSiteExteriorContext,
    commercialContextSignals: mergedCommercialContextSignals,
    impliedAccessContext: mergedImpliedAccessContext,
    residentialContext: mergedResidentialContext,
    conditionModifiers: mergedConditionModifiers,
    replaceableAssetScope: Boolean(base.replaceableAssetScope || refine.replaceableAssetScope),
    replaceableAssetCategory: base.replaceableAssetCategory || refine.replaceableAssetCategory || "",
    scopeAssetCategory: mergedScopeAssetCategory,
    scopeAssetFamily: mergedScopeAssetFamily,
    objectType: mergedObjectType,
    connectionModel: mergedConnectionModel,
    assemblyScale: mergedAssemblyScale,
    boundaryRiskHints: mergedBoundaryRiskHints,
    roughPrompt: mergedRoughPrompt,
    siteAssemblyHints: mergedSiteAssemblyHints,
    secondaryActionMethods: mergedSecondaryActionMethods,
    holeCreationIntent: mergedHoleCreationIntent,
    connectionMethodHints: mergedConnectionMethodHints,
    perimeterScopeHints: mergedPerimeterScopeHints,
    locationContextHints: mergedLocationContextHints,
    resetIntent: mergedResetIntent,
    partialScopeHints: mergedPartialScopeHints,
    openingClosureHints: mergedOpeningClosureHints,
    waterDamageRepairHints: mergedWaterDamageRepairHints,
    extentLightScopeHints: mergedExtentLightScopeHints,
    fieldSlangMethodHints: mergedFieldSlangMethodHints,
    scopeTradeBucket: mergedScopeTradeBucket,
    scopeWorkBucket: mergedScopeWorkBucket,
    detailLevel: mergedDetailLevel,
    inputShape: mergedInputShape,
    technicalScopeCompleteness: mergedTechnicalScopeCompleteness,
    expansionPressure: mergedExpansionPressure,
    scopeDepthTarget: mergedScopeDepthTarget,
    scopeExpansionActive: Boolean(base.scopeExpansionActive || refine.scopeExpansionActive || (refine.actions || []).length),
    scopeSkeleton: mergedScopeSkeleton,
    scopeProfile: base.scopeProfile || refine.scopeProfile || "",
    coreScopeText: base.coreScopeText || refine.coreScopeText || "",
  });
}

export function hasRiskAwareScopeSignals(analysis = {}) {
  return Boolean(
    analysis?.riskAwareInput
    || analysis?.safeWordingRequested
    || (Array.isArray(analysis?.riskTriggerTerms) && analysis.riskTriggerTerms.length > 0)
    || (Array.isArray(analysis?.uncertaintyPhrases) && analysis.uncertaintyPhrases.length > 0)
    || (analysis?.mentionsPatchOrRepair && Array.isArray(analysis?.locations) && analysis.locations.some((location) => /\baccess\b/i.test(location)))
  );
}

function hasTechnicalScopeSignals(analysis = {}) {
  return Boolean(
    (Array.isArray(analysis?.technicalSignals) && analysis.technicalSignals.length > 0)
    || analysis?.siteEquipmentScope
    || hasSiteEquipmentScopeSignals({
      coreScopeText: analysis?.coreScopeText,
      actions: analysis?.actions,
      items: analysis?.items,
      quantityItemPairs: analysis?.quantityItemPairs,
      actionItemPhrases: analysis?.actionItemPhrases,
      locations: analysis?.locations,
      technicalSignals: analysis?.technicalSignals,
    })
  );
}

function hasScopeExpansionSignals(analysis = {}) {
  return Boolean(
    analysis?.scopeExpansionActive
    || analysis?.expandRequested
    || hasTechnicalScopeSignals(analysis)
    || (analysis?.scopeWorkBucket && EXPANSION_WORK_BUCKETS.has(analysis.scopeWorkBucket))
    || analysis?.scopeAssetCategory
    || analysis?.objectType
    || analysis?.siteExteriorContext
    || analysis?.replaceableAssetScope
    || hasReplaceableAssetScopeSignals(analysis)
    || hasRiskAwareScopeSignals(analysis)
    || ((Array.isArray(analysis?.actions) && analysis.actions.length > 0)
      && ((Array.isArray(analysis?.items) && analysis.items.length > 0)
        || (Array.isArray(analysis?.quantityItemPairs) && analysis.quantityItemPairs.length > 0)
        || (Array.isArray(analysis?.actionItemPhrases) && analysis.actionItemPhrases.length > 0)))
  );
}

function isShortRoughScopePrompt(scopeText, analysis = {}) {
  const normalizedInput = sanitizeScopeAssistText(analysis?.coreScopeText || analysis?.rawScopeText || scopeText);
  if (!normalizedInput) return false;
  if (hasDevelopedScopeNoteSignals(normalizedInput, analysis)) return false;

  const wordCount = normalizedInput.split(/\s+/).filter(Boolean).length;
  const tokenCount = toComparableScopeTokens(normalizedInput).length;
  return Boolean(
    analysis?.scopeDepthTarget === "fuller_scope_draft"
    || analysis?.detailLevel === "vague"
    || analysis?.inputShape?.veryShortInput
    || analysis?.inputShape?.singleClauseInput
    || wordCount <= 4
    || tokenCount <= 5
  );
}

function hasDevelopedScopeNoteSignals(scopeText, analysis = {}) {
  const normalized = sanitizeScopeAssistText(scopeText || analysis?.coreScopeText || analysis?.rawScopeText);
  if (!normalized) return false;

  const sentenceCount = countSentences(normalized);
  const tokenCount = toComparableScopeTokens(normalized).length;
  const hasBoundaryLanguage = /\bnot included\b|\bexcluded\b|\bunless\b|\bidentified and approved\b/i.test(normalized);
  const hasCompletionLanguage = /\bclean up\b|\bcleanup\b|\bverify\b|\bready for finish\b|\boperation\b/i.test(normalized);

  return sentenceCount >= 2 && tokenCount >= 24 && hasBoundaryLanguage && hasCompletionLanguage;
}

function toComparableScopeTokens(text) {
  return sanitizeScopeAssistText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token && !ECHO_STOP_WORDS.has(token));
}

function intersectionSize(valuesA, valuesB) {
  const setA = new Set(valuesA);
  const setB = new Set(valuesB);
  let count = 0;
  setA.forEach((value) => {
    if (setB.has(value)) count += 1;
  });
  return count;
}

function countStructuredLines(text, mode) {
  const lines = sanitizeScopeAssistText(text).split("\n").map((line) => line.trim()).filter(Boolean);
  if (mode === "bullets") return lines.filter((line) => /^[-*•]\s+/.test(line)).length;
  if (mode === "numbered_list") return lines.filter((line) => /^\d+\.\s+/.test(line)).length;
  return lines.length;
}

function countSentences(text) {
  const matches = sanitizeScopeAssistText(text).match(/[.!?](?:\s|$)/g);
  return matches ? matches.length : 0;
}

function hasRiskAwareExpansion(text) {
  return /\bwhere required\b|\bif discovered\b|\bunless (?:identified|discovered|approved)\b|\bconcealed\b|\baccessible\b|\badditional\b|\bbeyond\b|\bafter access work\b|\bsubject to existing conditions\b/i.test(
    sanitizeScopeAssistText(text)
  );
}

function hasScopeEngineEnrichment(text) {
  return /\bunless (?:identified|discovered|approved)\b|\btest for\b|\btest fixture\b|\btest for leaks\b|\bverify(?:ing)?\b|\bclean up\b|\bwork area\b|\bleave ready for finish\b|\bsand smooth\b|\bminor patching only\b|\baccessible work areas?\b|\breconnect supply lines?\b|\bwax rings?\b|\bcloset bolts?\b|\bremove debris\b|\bdispose of removed materials\b|\bowner-supplied\b|\bfit-up\b|\balignment\b|\bfit and secure\b|\btrim components?\b|\bminor cuts\b|\bterminations?\b|\bidentification\b|\blabel(?:ing)?\b|\bsupports?\b|\bbends?\b|\bconduit run\b|\bfollow-on electrical work\b|\blift\b|\bcrane\b|\baccess equipment\b|\bsite-lighting conductors?\b|\bset and secure\b|\bfoundation\b|\bunderground wiring\b|\bsite connections?\b|\bdisconnect points?\b|\blayout\b|\bsealant\b|\bflashing\b|\bperimeter\b|\bweather(?:-|\s)?tight\b|\bopening\b|\btexture blending\b|\bgrid aligned\b|\bready for use\b|\bsubstrate\b|\bprofile\b|\banchorage\b/i.test(
    sanitizeScopeAssistText(text)
  );
}

function countDistinctScopeComponents(scopeNotes, analysis = {}) {
  const normalized = sanitizeScopeAssistText(scopeNotes);
  const profile = analysis?.scopeProfile || resolveScopeProfile(analysis);
  const componentChecks = {
    painting: [
      /\bprepare\b|\bprep(?:are)?\b|\bprotect\b|\bmask(?:ing)?\b/i,
      /\bpaint\b|\bprime\b|\bcoating\b/i,
      /\bclean up\b|\bcleanup\b|\bminor masking\b/i,
      /\bunless\b|\bnot included\b|\bsurface repair\b|\bconcealed damage\b|\bagreed work area\b/i,
    ],
    drywall: [
      /\bpatch\b|\bdemo\b|\brepair\b/i,
      /\bsand\b|\bready for finish\b|\btexture\b/i,
      /\bclean up\b|\bcleanup\b|\bremove debris\b/i,
      /\bminor patching only\b|\bunless\b|\bnot included\b|\bconcealed\b|\bextensive drywall replacement\b/i,
    ],
    toilet: [
      /\btoilet\b|\bremove and replace\b/i,
      /\bwax rings?\b|\bcloset bolts?\b|\breconnect supply lines?\b/i,
      /\btest\b|\bclean up\b|\bcleanup\b/i,
      /\bflange repair\b|\bshutoff replacement\b|\bcode-related\b|\bunless\b|\bnot included\b/i,
    ],
    vanity: [
      /\bvanity\b|\binstall\b|\breplace\b/i,
      /\bfit and secure\b/i,
      /\bclean up\b|\bcleanup\b/i,
      /\bplumbing reconnection\b|\bwall or floor repair\b|\bconcealed damage\b|\bunless\b|\bnot included\b/i,
    ],
    fixture: [
      /\bvanity\b|\bfaucet\b|\bfixture\b|\binstall\b|\breplace\b/i,
      /\breconnect supply lines?\b|\bfit and secure\b/i,
      /\btest\b|\bclean up\b|\bcleanup\b/i,
      /\bowner-supplied\b|\bunless\b|\bnot included\b/i,
    ],
    finish_carpentry: [
      /\bbaseboards?\b|\btrim\b|\bcasing\b|\bcrown\b|\bshoe\s*mold(?:ing)?\b/i,
      /\bfit\b|\bsecure\b|\bfasten\b|\bminor cuts\b|\badjustments for fit\b/i,
      /\bclean up\b|\bcleanup\b/i,
      /\bwall repair\b|\bfloor repair\b|\bpaint\b|\bstain\b|\bunless\b|\bnot included\b/i,
    ],
    finish_scope: [
      /\bfrp\b|\bceiling tiles?\b|\bvct\b|\bvinyl composition tile\b|\bfinish\b|\bpaint\b|\brepaint\b/i,
      /\blayout\b|\bcuts?\b|\btrim\b|\bfastening\b|\bsealant\b|\bfitting\b|\bsetting\b|\bprepare\b|\bprotect\b/i,
      /\bclean up\b|\bcleanup\b|\baligned\b|\bready for use\b/i,
      /\bunless\b|\bnot included\b|\bsubstrate\b|\bgrid\b|\bmoisture\b|\bbacking\b|\bconcealed\b/i,
    ],
    repair_scope: [
      /\brepair\b|\bpatch\b|\bstucco\b|\bcurbs?\b|\bstorefront frame\b/i,
      /\bprepare\b|\bremove loose\b|\btexture\b|\bblend\b|\badjustments?\b|\bsealant\b|\bprofile\b/i,
      /\bclean up\b|\bcleanup\b/i,
      /\bunless\b|\bnot included\b|\bstructural\b|\bsubstrate\b|\bmoisture\b|\btraffic control\b|\bglass replacement\b/i,
    ],
    universal_scope: [
      /\bwindows?\b|\bskylights?\b|\blouvers?\b|\bguardrails?\b|\baccess panels?\b|\bfascia\b|\bawnings?\b|\bhatches?\b|\bman doors?\b|\btrim\b|\bflashing\b|\bstorefront\b/i,
      /\bset and secure\b|\bfit and secure\b|\banchorage\b|\bperimeter\b|\bsealant\b|\bflashing\b|\btrim tie-in\b|\balignment\b|\bclosure\b/i,
      /\bverify\b|\boperation\b|\balignment\b|\bclean up\b|\bcleanup\b|\bdispose of\b/i,
      /\bunless\b|\bnot included\b|\bconcealed damage\b|\bsubstrate\b|\bframing\b|\bflashing\b|\bfinish repairs?\b|\bconcrete\b|\banchorage\b/i,
    ],
    equipment_asset: [
      /\bwater heaters?\b|\btankless water heaters?\b|\btoilet(?:s)?\b|\bsinks?\b|\bfaucets?\b|\bdrinking fountains?\b|\bmop sinks?\b|\bfixtures?\b|\bexhaust fans?\b|\brestroom fans?\b|\bvent fans?\b|\bvents?\b|\brooftop units?\b|\brtu\b|\bcondensers?\b|\bair handlers?\b|\bmini[\s-]?splits?\b|\bdisconnect(?:s)?\b|\bbreakers?\b|\bpanels?\b|\bdoor closers?\b|\bdoors?\b|\bstorefront glass\b|\bstorefront frame\b|\bstorefront hardware\b|\bsigns?\b|\bmounted signs?\b|\bsign posts?\b|\bfence sections?\b|\bbollards?\b|\bgates?\b|\bcanop(?:y|ies)\b|\bgate operators?\b|\bappliances?\b|\bmounted equipment\b|\butility-connected equipment\b|\bequipment\b|\bunits?\b/i,
      /\bdisconnect and reconnect\b|\bdisconnect accessible\b|\bcomplete accessible\b|\bmounting\b|\bsecure\b|\banchorage\b|\bterminations?\b|\battachments?\b|\badjust(?:ment|ments)\b|\bfit\b|\brelief\b|\bduct\b|\bvent\b|\bgas\b|\bwater\b|\bdrain\b|\brefrigerant\b|\bcontrols?\b|\butilities?\b|\bsealant\b|\bsetting\b/i,
      /\bverify\b|\bproper operation\b|\bclean up\b|\bcleanup\b|\bdispose of\b|\bremove and dispose\b/i,
      /\bunless\b|\bnot included\b|\bcode\b|\butility\b|\bstructural\b|\bframe\b|\bstorefront\b|\bglazing\b|\bfoundation\b|\bunderground\b/i,
    ],
    technical: [
      /\borbital\b|\bweld\b|\bstainless\b|\btub(?:e|ing)\b|\bpiping\b|\blines?\b|\binstrument(?:ation)?\b|\bpanel\b|\bbreakers?\b|\bdisconnect\b|\bconduit\b|\bpackage unit\b|\brtu\b|\blight poles?\b|\bpole lights?\b|\blight standards?\b|\bsite lighting\b|\bmounted asset\b|\bexterior equipment\b|\bsite equipment\b|\bsite asset\b|\bsign poles?\b|\bbollards?\b/i,
      /\bfit-up\b|\balignment\b|\btie(?:-| )?in\b|\bterminations?\b|\baccessible runs\b|\bwork area\b|\bidentification\b|\blabel(?:ing)?\b|\bsupports?\b|\bbends?\b|\breconnect\b|\brouting\b|\broute\b|\blift\b|\bcrane\b|\baccess equipment\b|\bdisconnect(?:ing)? accessible\b|\bsite-lighting conductors?\b|\bset and secure\b|\bremove debris\b|\bdispose of removed materials\b/i,
      /\bsub[ -]?fab\b|\bcleanroom\b|\bintel\b|\bplant\b|\bfacility\b|\bpanel\b|\brooftop\b|\bwarehouse\b|\btenant improvement\b|\bcommercial\b|\bhotel\b|\bparking lot\b|\bcampus\b|\bproperty\b|\boutdoor\b|\bexterior\b/i,
      /\bqa\b|\bqc\b|\btesting\b|\bshutdown\b|\bprogramming\b|\blive-system\b|\bverify\b|\bready for follow-on electrical work\b|\bverify operation where applicable\b/i,
      /\bstated limits\b|\bunless\b|\bnot included\b|\bwork outside\b|\bfeeder\b|\bcode-driven\b|\bwire pull\b|\bmajor demolition\b|\bfoundation\b|\bunderground wiring\b|\butility\/service changes\b|\baccessible disconnect points?\b|\bsite connections?\b/i,
    ],
    generic: [
      /\binstall\b|\breplace\b|\bpaint\b|\bpatch\b|\brepair\b|\bremove\b|\bweld\b|\bfinish\b/i,
      /\bprepare\b|\bprotect\b|\bfit\b|\bsecure\b|\breconnect\b|\bsand\b|\btest\b|\bclean up\b|\bremove debris\b/i,
      /\bunless\b|\bnot included\b|\bwhere required\b|\bas needed\b/i,
    ],
  };

  const checks = componentChecks[profile] || componentChecks.generic;
  return checks.filter((regex) => regex.test(normalized)).length;
}

function lacksMinimumScopeComponents(scopeNotes, analysis = {}) {
  const format = analysis?.formattingIntent || "";
  const depthTarget = analysis?.scopeDepthTarget || "";
  const detailLevel = analysis?.detailLevel || "";
  const components = countDistinctScopeComponents(scopeNotes, analysis);

  if (depthTarget === "light_refinement") return false;

  if (format === "sentence") {
    if (depthTarget === "technical_trade_expansion") return components < 3;
    if (depthTarget === "fuller_scope_draft") return components < 2;
    return components < 2;
  }

  if (depthTarget === "technical_trade_expansion") return components < 4;
  if (depthTarget === "fuller_scope_draft" || detailLevel === "vague") return components < 3;
  if (depthTarget === "moderate_expansion") return components < 2;
  return false;
}

function hasRepetitiveCookieCutterBoilerplate(scopeNotes, analysis = {}) {
  const normalized = sanitizeScopeAssistText(scopeNotes);
  const profile = analysis?.scopeProfile || "";
  if (!normalized) return false;

  const repeatedBoilerplate = (
    /\bprepare designated surfaces as needed\b/i.test(normalized)
    && /\bagreed work area\b/i.test(normalized)
    && !["painting", "generic"].includes(profile)
  );
  const shallowBoilerplate = /\bstandard prep\b|\bminor prep\b|\bgeneral cleanup\b/i.test(normalized);

  return repeatedBoilerplate || shallowBoilerplate;
}

function countTechnicalSignalCoverage(scopeNotes, analysis = {}) {
  const output = sanitizeScopeAssistText(scopeNotes).toLowerCase();
  const signals = uniqueList(analysis?.technicalSignals || []);
  if (!signals.length) return 0;

  const checks = [
    { label: "orbital welding", regex: /\borbital\b|\bweld(?:ing)?\b/i },
    { label: "welding", regex: /\bweld(?:ing)?\b/i },
    { label: "stainless steel", regex: /\bstainless\b/i },
    { label: "instrumentation", regex: /\binstrument(?:ation)?\b/i },
    { label: "controls", regex: /\bcontrols?\b/i },
    { label: "panel work", regex: /\bpanel\b/i },
    { label: "tie-in", regex: /\btie(?:-| )?in(?:s)?\b/i },
    { label: "circuit breaker work", regex: /\bcircuit breakers?\b|\bbreakers?\b/i },
    { label: "disconnect work", regex: /\bdisconnect(?:s)?\b/i },
    { label: "conduit work", regex: /\bconduit\b|\bemt\b|\bimc\b|\brigid\b|\braceway\b/i },
    { label: "process tubing", regex: /\bprocess tubing\b|\btubing\b/i },
    { label: "fractional sizing", regex: /\b\d+\/\d+\b/ },
    { label: "line footage", regex: /\b\d+(?:\.\d+)?\s*(?:feet|foot|ft)\b/i },
    { label: "process lines", regex: /\blines?\b|\btubing\b|\btube\b|\bpiping\b/i },
    { label: "rooftop equipment", regex: /\brooftop\b|\bpackage unit\b|\brtu\b/i },
    { label: "tenant improvement", regex: /\btenant improvement\b|\bti\b/i },
    { label: "site lighting equipment", regex: SITE_LIGHTING_ASSET_REGEX },
    { label: "site asset work", regex: SITE_ASSET_REGEX },
    { label: "sub-fab environment", regex: /\bsub[ -]?fab\b/i },
    { label: "fab environment", regex: /\bfab\b/i },
    { label: "cleanroom environment", regex: /\bcleanroom\b/i },
    { label: "industrial site", regex: /\bintel\b|\bplant\b|\bfacility\b/i },
  ];

  return checks
    .filter((entry) => signals.includes(entry.label))
    .filter((entry) => entry.regex.test(output))
    .length;
}

function hasTechnicalSignalCoverage(scopeNotes, analysis = {}) {
  const signals = uniqueList(analysis?.technicalSignals || []);
  if (!signals.length) return true;
  return countTechnicalSignalCoverage(scopeNotes, analysis) > 0;
}

function hasTechnicalExecutionCoverage(scopeNotes) {
  return /\bfit-up\b|\balignment\b|\btie(?:-| )?in\b|\bterminations?\b|\baccessible runs?\b|\broute\b|\brouting\b|\binstall\b|\bweld\b|\btubing\b|\bpiping\b|\bpanel\b|\bbreakers?\b|\bdisconnect\b|\bconduit\b|\blabel(?:ing)?\b|\bidentification\b|\bsupports?\b|\bbends?\b|\breconnect\b|\blift\b|\bcrane\b|\baccess equipment\b|\bsite-lighting conductors?\b|\bset and secure\b|\bdispose of removed materials\b/i.test(
    sanitizeScopeAssistText(scopeNotes)
  );
}

function hasTechnicalBoundaryCoverage(scopeNotes) {
  return /\bqa\b|\bqc\b|\btesting\b|\bshutdown\b|\bprogramming\b|\blive-system\b|\bstated limits?\b|\bunless specifically identified and approved\b|\bwork outside\b|\bfoundation\b|\bunderground wiring\b|\butility\/service changes\b|\bdisconnect points?\b|\bsite connections?\b/i.test(
    sanitizeScopeAssistText(scopeNotes)
  );
}

function hasTechnicalEnvironmentRequirement(analysis = {}) {
  return Boolean(
    (Array.isArray(analysis?.locations) && analysis.locations.length > 0)
    || (Array.isArray(analysis?.technicalSignals) && analysis.technicalSignals.some((signal) =>
      ["sub-fab environment", "fab environment", "cleanroom environment", "industrial site", "panel work", "site lighting equipment", "site asset work"].includes(signal)
    ))
    || analysis?.siteEquipmentScope
  );
}

function hasTechnicalEnvironmentCoverage(scopeNotes, analysis = {}) {
  const normalized = sanitizeScopeAssistText(scopeNotes);
  if (!hasTechnicalEnvironmentRequirement(analysis)) return true;

  if (Array.isArray(analysis?.locations) && analysis.locations.some((location) => new RegExp(`\\b${location.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(normalized))) {
    return true;
  }

  return /\bsub[ -]?fab\b|\bfab\b|\bcleanroom\b|\bintel\b|\bplant\b|\bfacility\b|\bpanel\b|\brooftop\b|\bwarehouse\b|\btenant improvement\b|\bcommercial\b|\bhotel\b|\bparking lot\b|\bcampus\b|\bproperty\b|\boutdoor\b|\bexterior\b/i.test(normalized);
}

function hasTechnicalResidentialBoilerplate(scopeNotes) {
  return /\bdesignated surfaces?\b|\badjacent areas?\b|\bmask(?:ing)?\b|\bpaint\b|\bdrywall\b|\bconcealed damage\b|\bwall repair\b/i.test(
    sanitizeScopeAssistText(scopeNotes)
  );
}

function hasTechnicalScopeDensityGap(scopeNotes, analysis = {}) {
  if ((analysis?.scopeProfile || resolveScopeProfile(analysis)) !== "technical") return false;
  if (analysis?.scopeDepthTarget === "light_refinement" && analysis?.expansionPressure === "low") return false;

  const normalized = sanitizeScopeAssistText(scopeNotes);
  const signalCount = uniqueList(analysis?.technicalSignals || []).length;
  const coverageCount = countTechnicalSignalCoverage(normalized, analysis);
  const requiredCoverage = signalCount >= 7 ? 3 : signalCount >= 3 ? 2 : 1;
  const componentCount = countDistinctScopeComponents(normalized, analysis);
  const sentenceCount = countSentences(normalized);
  const structuredLines = countStructuredLines(normalized, analysis?.formattingIntent || "");
  const format = analysis?.formattingIntent || "";

  const tooLightForFormat = (
    (format === "sentence" && sentenceCount !== 1)
    || ((format === "bullets" || format === "numbered_list") && structuredLines < 3)
    || (!format && sentenceCount < 3)
    || (format === "paragraph" && sentenceCount < 3)
  );

  return coverageCount < requiredCoverage
    || componentCount < 4
    || !hasTechnicalExecutionCoverage(normalized)
    || !hasTechnicalBoundaryCoverage(normalized)
    || !hasTechnicalEnvironmentCoverage(normalized, analysis)
    || hasTechnicalResidentialBoilerplate(normalized)
    || tooLightForFormat;
}

function isTooShortForExpectedDepth(scopeNotes, analysis = {}) {
  const depthTarget = analysis?.scopeDepthTarget || "";
  const format = analysis?.formattingIntent || "";
  const normalized = sanitizeScopeAssistText(scopeNotes);
  const tokenCount = toComparableScopeTokens(normalized).length;
  const sentenceCount = countSentences(normalized);
  const structuredLines = countStructuredLines(normalized, format);

  if (format === "sentence") {
    if (depthTarget === "technical_trade_expansion") return tokenCount < 22;
    if (depthTarget === "fuller_scope_draft") return tokenCount < 15;
    return false;
  }

  if (format === "bullets" || format === "numbered_list") {
    if (depthTarget === "technical_trade_expansion") return structuredLines < 3;
    if (depthTarget === "fuller_scope_draft") return structuredLines < 3;
    return false;
  }

  if (format === "paragraph") {
    if (depthTarget === "technical_trade_expansion") return sentenceCount < 3 || tokenCount < 34;
    if (depthTarget === "fuller_scope_draft") return sentenceCount < 2 || tokenCount < 20;
    return false;
  }

  if (depthTarget === "technical_trade_expansion") return sentenceCount < 3 || tokenCount < 30;
  if (depthTarget === "fuller_scope_draft") return sentenceCount < 2 || tokenCount < 18;
  if (depthTarget === "moderate_expansion") return tokenCount < 16;
  return false;
}

function hasUnrequestedStructuredOutput(scopeNotes, analysis = {}) {
  if (analysis?.formattingIntent) return false;
  const lines = sanitizeScopeAssistText(scopeNotes).split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.some((line) => /^[-*•]\s+/.test(line) || /^\d+\.\s+/.test(line));
}

function lacksDefaultParagraphDevelopment(scopeNotes, analysis = {}) {
  if (analysis?.formattingIntent) return false;

  const normalized = sanitizeScopeAssistText(scopeNotes);
  const sentenceCount = countSentences(normalized);
  const tokenCount = toComparableScopeTokens(normalized).length;
  const depthTarget = analysis?.scopeDepthTarget || "";
  const detailLevel = analysis?.detailLevel || "";

  if (depthTarget === "light_refinement") return false;

  if (depthTarget === "technical_trade_expansion" || detailLevel === "technical") {
    return sentenceCount < 3 || tokenCount < 36;
  }

  if (depthTarget === "fuller_scope_draft" || detailLevel === "vague") {
    return sentenceCount < 2 || tokenCount < 22;
  }

  if (depthTarget === "moderate_expansion" || detailLevel === "mid_detail") {
    return sentenceCount < 2 || tokenCount < 20;
  }

  return false;
}

function hasTradeMismatchBoilerplate(scopeNotes, analysis = {}) {
  const normalized = sanitizeScopeAssistText(scopeNotes);
  const profile = analysis?.scopeProfile || "";

  if (profile === "technical") {
    return !hasTechnicalSignalCoverage(normalized, analysis)
      || (GENERIC_COOKIE_CUTTER_EXCLUSION_REGEX.test(normalized) && !/\bqa\b|\bqc\b|\bshutdown\b|\blimits?\b/i.test(normalized));
  }

  if (profile === "painting") return /\bwax rings?\b|\bcloset bolts?\b|\bsupply lines?\b/i.test(normalized);
  if (profile === "toilet") return /\bdesignated surfaces?\b|\bmasking\b|\bpaint\b/i.test(normalized);
  if (profile === "drywall") return /\bwax rings?\b|\bcloset bolts?\b|\bsupply lines?\b/i.test(normalized);
  if (profile === "finish_scope") return /\bwax rings?\b|\bcloset bolts?\b|\bsupply lines?\b|\bresidential\b/i.test(normalized);
  if (profile === "repair_scope") return /\bwax rings?\b|\bcloset bolts?\b|\bsupply lines?\b|\bminor masking\b/i.test(normalized);
  if (profile === "universal_scope") return /\bwax rings?\b|\bcloset bolts?\b|\bsupply lines?\b|\bpaint the agreed work area\b/i.test(normalized);
  if (profile === "vanity") return /\bwax rings?\b|\bcloset bolts?\b|\bpaint\b/i.test(normalized);
  if (profile === "finish_carpentry") return /\bwax rings?\b|\bcloset bolts?\b|\bsupply lines?\b|\bplumbing reconnection\b/i.test(normalized);
  if (profile === "equipment_asset") return /\bdesignated surfaces?\b|\badjacent areas?\b|\bmasking\b|\bpaint\b|\bdrywall\b|\bwax rings?\b|\bcloset bolts?\b/i.test(normalized);
  return false;
}

function hasGenericScopeScaffold(scopeNotes) {
  const normalized = sanitizeScopeAssistText(scopeNotes);
  if (!normalized) return false;
  return (
    /\bcomplete the described scope\b/i.test(normalized)
    || /\bcomplete the stated scope\b/i.test(normalized)
  ) && (
    /\bclean up the work area\b/i.test(normalized)
    || /\bconcealed damage\b/i.test(normalized)
    || /\bsubstrate correction\b/i.test(normalized)
  );
}

function isGenericScopeSummary(scopeNotes, { userInput = "", analysis = {} } = {}) {
  const normalizedOutput = sanitizeScopeAssistText(scopeNotes);
  const normalizedInput = sanitizeScopeAssistText(analysis?.coreScopeText || userInput);
  if (!normalizedOutput || !normalizedInput) return false;
  if (hasGenericScopeScaffold(normalizedOutput)) return true;
  if (!GENERIC_SCOPE_SUMMARY_PREFIX_REGEX.test(normalizedOutput)) return false;

  const inputTokens = toComparableScopeTokens(normalizedInput);
  const outputTokens = toComparableScopeTokens(normalizedOutput.replace(GENERIC_SCOPE_SUMMARY_PREFIX_REGEX, ""));
  if (!inputTokens.length || !outputTokens.length) return false;

  const overlap = intersectionSize(inputTokens, outputTokens) / Math.max(1, Math.min(inputTokens.length, outputTokens.length));
  return overlap >= 0.5
    && outputTokens.length <= inputTokens.length + 4
    && !hasScopeEngineEnrichment(normalizedOutput)
    && countSentences(normalizedOutput) <= 1;
}

function shouldPreferRicherScopeRewrite(scopeNotes, { userInput = "", analysis = {} } = {}) {
  const resolvedAnalysis = analysis && typeof analysis === "object" ? analysis : {};
  const roughPrompt = isShortRoughScopePrompt(userInput, resolvedAnalysis);
  if (!hasScopeExpansionSignals(resolvedAnalysis) && !roughPrompt) return false;

  const expansionPressure = resolvedAnalysis?.expansionPressure || "";
  if (!["high", "medium"].includes(expansionPressure) && !roughPrompt) return false;

  const normalizedOutput = sanitizeScopeAssistText(scopeNotes);
  const normalizedInput = sanitizeScopeAssistText(resolvedAnalysis?.coreScopeText || userInput);
  if (!normalizedOutput || !normalizedInput) return false;
  if (!resolvedAnalysis?.expandRequested && hasDevelopedScopeNoteSignals(normalizedInput, resolvedAnalysis)) return false;

  const inputTokens = toComparableScopeTokens(normalizedInput);
  const outputTokens = toComparableScopeTokens(normalizedOutput);
  if (!inputTokens.length || !outputTokens.length) return false;

  const overlap = intersectionSize(inputTokens, outputTokens) / Math.max(1, Math.min(inputTokens.length, outputTokens.length));
  const overlapFloor = expansionPressure === "high" ? 0.6 : 0.66;
  if (overlap < overlapFloor) return false;

  const fallback = sanitizeScopeAssistText(buildRiskAwareScopeEchoFallback({ analysis: resolvedAnalysis }));
  if (!fallback || fallback === normalizedOutput) return false;

  const outputComponentCount = countDistinctScopeComponents(normalizedOutput, resolvedAnalysis);
  const fallbackComponentCount = countDistinctScopeComponents(fallback, resolvedAnalysis);
  const outputTokenCount = outputTokens.length;
  const fallbackTokenCount = toComparableScopeTokens(fallback).length;
  const requiredTokenLift = expansionPressure === "high" ? 6 : 10;

  return fallbackComponentCount > outputComponentCount
    && fallbackTokenCount >= outputTokenCount + requiredTokenLift;
}

export function isWeakRiskAwareScopeEcho(scopeNotes, { userInput = "", analysis = {} } = {}) {
  const resolvedAnalysis = analysis && typeof analysis === "object" ? analysis : {};
  const roughPrompt = isShortRoughScopePrompt(userInput, resolvedAnalysis);
  if (!hasScopeExpansionSignals(resolvedAnalysis) && !roughPrompt) return false;

  const normalizedOutput = sanitizeScopeAssistText(scopeNotes);
  const normalizedInput = sanitizeScopeAssistText(resolvedAnalysis?.coreScopeText || userInput);
  if (!normalizedOutput || !normalizedInput) return false;
  if (!resolvedAnalysis?.expandRequested && hasDevelopedScopeNoteSignals(normalizedInput, resolvedAnalysis)) return false;

  const inputTokens = toComparableScopeTokens(normalizedInput);
  const outputTokens = toComparableScopeTokens(normalizedOutput);
  if (!inputTokens.length || !outputTokens.length) return false;

  const overlap = intersectionSize(inputTokens, outputTokens) / Math.max(1, Math.min(inputTokens.length, outputTokens.length));
  const expansionPressure = resolvedAnalysis?.expansionPressure || "";
  const structureMode = resolvedAnalysis?.formattingIntent || "";
  const structureWeak = (
    (structureMode === "bullets" && countStructuredLines(normalizedOutput, "bullets") < 2)
    || (structureMode === "numbered_list" && countStructuredLines(normalizedOutput, "numbered_list") < 2)
  );
  const paragraphWeak = (
    structureMode === "paragraph"
    && countSentences(normalizedOutput) < 2
    && normalizedInput.split(/\s+/).filter(Boolean).length >= 4
  );
  const sentenceWeak = structureMode === "sentence" && countSentences(normalizedOutput) !== 1;
  const enrichmentWeak = !hasScopeEngineEnrichment(normalizedOutput) && !(hasRiskAwareScopeSignals(resolvedAnalysis) && hasRiskAwareExpansion(normalizedOutput));
  const genericSummaryWeak = isGenericScopeSummary(normalizedOutput, { userInput, analysis: resolvedAnalysis });
  const depthWeak = isTooShortForExpectedDepth(normalizedOutput, resolvedAnalysis);
  const mismatchWeak = hasTradeMismatchBoilerplate(normalizedOutput, resolvedAnalysis);
  const componentWeak = lacksMinimumScopeComponents(normalizedOutput, resolvedAnalysis);
  const repetitiveWeak = hasRepetitiveCookieCutterBoilerplate(normalizedOutput, resolvedAnalysis);
  const specialtyDensityWeak = hasTechnicalScopeDensityGap(normalizedOutput, resolvedAnalysis);
  const defaultFormatWeak = hasUnrequestedStructuredOutput(normalizedOutput, resolvedAnalysis);
  const defaultParagraphWeak = lacksDefaultParagraphDevelopment(normalizedOutput, resolvedAnalysis);
  const overlapFloor = expansionPressure === "high" ? 0.64 : expansionPressure === "medium" ? 0.68 : 0.72;
  const tokenLiftAllowance = expansionPressure === "high" ? 12 : expansionPressure === "medium" ? 9 : 6;
  const lengthLiftWeak = outputTokens.length <= inputTokens.length + tokenLiftAllowance && expansionPressure !== "low";
  const pressureThinOutput = expansionPressure === "high"
    && !resolvedAnalysis?.formattingIntent
    && outputTokens.length <= inputTokens.length + 12
    && countSentences(normalizedOutput) < 3;

  return genericSummaryWeak
    || mismatchWeak
    || componentWeak
    || repetitiveWeak
    || specialtyDensityWeak
    || defaultFormatWeak
    || defaultParagraphWeak
    || pressureThinOutput
    || (
    overlap >= overlapFloor
    && (
      structureWeak
      || paragraphWeak
      || sentenceWeak
      || enrichmentWeak
      || depthWeak
      || mismatchWeak
      || componentWeak
      || repetitiveWeak
      || specialtyDensityWeak
      || defaultFormatWeak
      || defaultParagraphWeak
      || lengthLiftWeak
    )
  );
}

function capitalizePhrase(text) {
  const normalized = asText(text).trim();
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "";
}

function decapitalizePhrase(text) {
  const normalized = asText(text).trim();
  return normalized ? normalized.charAt(0).toLowerCase() + normalized.slice(1) : "";
}

function ensureSentence(text) {
  const normalized = asText(text).replace(/[.]+$/g, "").trim();
  return normalized ? `${normalized}.` : "";
}

function stripSentencePunctuation(text) {
  return asText(text).replace(/[.]+$/g, "").trim();
}

function joinPlainPhrases(values) {
  const parts = uniqueList(values)
    .map((value) => stripSentencePunctuation(value))
    .filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${decapitalizePhrase(parts[1])}`;
  const last = parts.pop();
  return `${parts.join(", ")}, and ${decapitalizePhrase(last)}`;
}

function getSkeletonValues(analysis, category, bucket) {
  return uniqueList(analysis?.scopeSkeleton?.[category]?.[bucket] || []);
}

function firstSkeletonValue(analysis, category, bucket) {
  return getSkeletonValues(analysis, category, bucket)[0] || "";
}

function normalizeScopePhrase(text) {
  return stripSentencePunctuation(
    asText(text)
      .replace(/\bowner supplied\b/gi, "owner-supplied")
      .replace(/\bfrp\b/g, "FRP")
      .replace(/\bvct\b/g, "VCT")
      .replace(/\brtu\b/gi, "RTU")
  );
}

function normalizeTargetPhrase(text) {
  return normalizeScopePhrase(text)
    .replace(/^(?:swap(?:ped|ping)?(?:\s+out)?|change(?:d|ing)?\s+out|remove(?:d|ing)?(?:\s+and)?\s+replace(?:d|ing)?|tear(?:ing)?\s+out|decommission(?:ed|ing)?(?:\s+and\s+remove)?|furnish(?:ed|ing)?\s+and\s+install|provide(?:d|ing)?\s+and\s+install|put(?:ting)?(?:\s+(?:up|in|back))?|install|reinstall(?:ed|ing)?|replace|remove|demo|demolish|repair|patch|restore|correct|rework|redo|repaint|paint|coat|re-?caulk(?:ed|ing)?|caulk|seal|mount|set|add|frame(?:d|ing)?\s+out|fix|make\s+good|tighten|adjust|align(?:ed|ing)?|level(?:ed|ing)?|plumb|square|reset(?:ting)?|reattach(?:ed|ing)?|rehang(?:ed|ing)?|rekey(?:ed|ing)?|touch(?:ed|ing)?\s+up|blend(?:ed|ing)?|close\s+in|close(?:d|ing)?(?:\s+it)?\s+up|flash(?:ed|ing)?(?:\s+around)?|(?:re)?secure(?:d|ing)?)\s+/i, "")
    .replace(/^around\s+/i, "")
    .replace(/\bnew\s+ones?\b/gi, "")
    .replace(/\bnew\s+one\b/gi, "")
    .replace(/\bold\s+opening\b/gi, "opening")
    .replace(/\b(?:it|them|one|ones)\b$/i, "")
    .replace(/^(?:bad|broken|busted|old)\s+/i, "")
    .replace(/\b(?:and\s+)?(?:bolt(?:ed|ing)?(?:\s+(?:it\s+)?(?:back\s+)?(?:up|down))?|anchor(?:ed|ing)?(?:\s+(?:it\s+)?(?:back\s+)?down)?|(?:re)?secure(?:d|ing)?(?:\s+(?:it|them|back))?|reattach(?:ed|ing)?(?:\s+(?:it|them|back))?)\b.*$/i, "")
    .replace(/\bback\s+up\b/gi, "")
    .replace(/\bafter repair\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function supportsContextualLowLevelTarget(regex) {
  if (!(regex instanceof RegExp)) return false;
  return [
    DOOR_HARDWARE_ASSET_REGEX,
    MINOR_HARDWARE_COMPONENT_REGEX,
    PERIMETER_ACCESSORY_OBJECT_REGEX,
    LOW_LEVEL_TRIM_COMPONENT_REGEX,
  ].some((candidate) => candidate.source === regex.source);
}

function extractContextualLowLevelTargetPhrase(source, match) {
  const rawSource = asText(source).trim();
  const matchedText = asText(match?.[0]).trim();
  const matchIndex = Number(match?.index);
  if (!rawSource || !matchedText || !Number.isFinite(matchIndex) || matchIndex < 0) return "";

  const prefixSource = rawSource.slice(0, matchIndex).replace(/[,:;]+$/g, " ").trim();
  const suffixSource = rawSource.slice(matchIndex + matchedText.length).trim();

  let prefix = "";
  const normalizedPrefix = normalizeTargetPhrase(prefixSource);
  if (normalizedPrefix && !/\b(?:and|or)\b/i.test(normalizedPrefix)) {
    const prefixTokens = normalizedPrefix.split(/\s+/).filter(Boolean);
    prefix = prefixTokens.slice(-3).join(" ");
  }

  const suffixMatch = suffixSource.match(
    /^(?:at|on|in|around|by|for|within|to)\s+[a-z0-9/-]+(?:\s+[a-z0-9/-]+){0,4}/i
  );
  const suffix = suffixMatch ? normalizeScopePhrase(suffixMatch[0]) : "";

  const contextual = [prefix, matchedText, suffix].filter(Boolean).join(" ");
  const normalizedContextual = normalizeTargetPhrase(contextual);
  const normalizedMatched = normalizeTargetPhrase(matchedText);

  return normalizedContextual && normalizedContextual !== normalizedMatched
    ? normalizedContextual
    : normalizedMatched;
}

function isLowLevelPerimeterComponentTarget(text = "") {
  return /\bweather[-\s]?strips?\b|\bweatherstrips?\b|\bperimeter seals?\b|\bedge seals?\b|\bframe seals?\b|\bgaskets?\b|\bdoor sweeps?\b|\bsweeps?\b|\bthresholds?\b|\bsealant\b|\bcaulk(?:ing)?\b/i.test(
    asText(text)
  );
}

function isLowLevelSupportComponentTarget(text = "") {
  return /\b(?:support\s+)?brackets?\b|\bwall brackets?\b|\bpost brackets?\b|\bpanel supports?\b|\bsupports?\b|\bbraces?\b|\bcaps?\b|\bpost caps?\b|\btrim caps?\b|\bcovers?\b|\bcover plates?\b|\bpanel covers?\b|\bclips?\b|\bplates?\b|\btabs?\b|\bfastener points?\b/i.test(
    asText(text)
  );
}

function pickPreferredTargetCandidate(candidates = []) {
  return uniqueList(candidates)
    .find((value) => {
      const normalized = normalizeTargetPhrase(value);
      return normalized && !PLACEHOLDER_TARGET_REGEX.test(normalized);
    }) || candidates[0] || "";
}

function mergeWorkflowClauses(baseClauses = [], extraClauses = []) {
  const normalized = [];
  const seen = new Set();

  [...baseClauses, ...extraClauses]
    .map((value) => stripSentencePunctuation(value))
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .forEach((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      normalized.push(value);
    });

  return normalized;
}

function renderExclusionSentence(text) {
  const phrase = normalizeScopePhrase(text);
  if (!phrase) return "";
  if (/\b(?:not included|excluded|unless)\b/i.test(phrase)) return ensureSentence(capitalizePhrase(phrase));
  return ensureSentence(`Exclude ${phrase}`);
}

function buildLocationSuffix(location) {
  const normalized = asText(location).trim();
  if (!normalized) return "";
  if (/\baccess\b/i.test(normalized)) return ` for ${normalized}`;
  if (/\bedge\b|\bentry\b|\bstair\b|\bgate\b|\byard\b/i.test(normalized)) return ` at ${normalized}`;
  if (/^(office|bath|bathroom|restroom|kitchen|garage|suite|room|lobby|hallway|corridor|closet|unit|floor|ceiling|wall|walls|interior|exterior|fab|sub fab|cleanroom)\b/i.test(normalized)) {
    return ` in ${normalized}`;
  }
  return ` at ${normalized}`;
}

function extractMatchedScopePhrase(text, regex) {
  const source = asText(text).trim();
  if (!source || !(regex instanceof RegExp)) return "";
  const flags = regex.flags.replace(/g/g, "");
  const matcher = new RegExp(regex.source, flags);
  const match = matcher.exec(source);
  if (!match || !match[0]) return "";
  if (supportsContextualLowLevelTarget(regex)) {
    return extractContextualLowLevelTargetPhrase(source, match) || "";
  }
  return normalizeTargetPhrase(match[0]) || "";
}

function resolvePreferredObjectMatcher(analysis = {}) {
  const category = analysis?.scopeAssetCategory || resolveScopeAssetCategory(analysis);
  const objectType = analysis?.objectType || resolveObjectType({ ...analysis, scopeAssetCategory: category });

  if (hasCorpusMatch(analysis, DOOR_HARDWARE_ASSET_REGEX)) return DOOR_HARDWARE_ASSET_REGEX;
  if (hasCorpusMatch(analysis, MINOR_HARDWARE_COMPONENT_REGEX)) return MINOR_HARDWARE_COMPONENT_REGEX;
  if (
    hasCorpusMatch(analysis, FRAME_PERIMETER_OBJECT_REGEX)
    && (hasCorpusMatch(analysis, PERIMETER_SEAL_METHOD_REGEX) || hasCorpusMatch(analysis, PERIMETER_ACCESSORY_OBJECT_REGEX))
  ) {
    return FRAME_PERIMETER_OBJECT_REGEX;
  }
  if (hasCorpusMatch(analysis, PERIMETER_ACCESSORY_OBJECT_REGEX)) return PERIMETER_ACCESSORY_OBJECT_REGEX;
  if (hasCorpusMatch(analysis, LOW_LEVEL_TRIM_COMPONENT_REGEX)) return LOW_LEVEL_TRIM_COMPONENT_REGEX;
  if (hasCorpusMatch(analysis, INTERIOR_BUILTIN_ASSET_REGEX)) return INTERIOR_BUILTIN_ASSET_REGEX;
  if (hasCorpusMatch(analysis, PANEL_CLOSURE_OBJECT_REGEX)) return PANEL_CLOSURE_OBJECT_REGEX;
  if (hasCorpusMatch(analysis, TRIM_ACCESSORY_OBJECT_REGEX)) return TRIM_ACCESSORY_OBJECT_REGEX;
  if (category === "door_hardware") return DOOR_HARDWARE_ASSET_REGEX;
  if (objectType === "hardware_component") {
    return hasCorpusMatch(analysis, MINOR_HARDWARE_COMPONENT_REGEX)
      ? MINOR_HARDWARE_COMPONENT_REGEX
      : DOOR_HARDWARE_ASSET_REGEX;
  }
  if (category === "interior_builtin" || objectType === "built_in_assembly") return INTERIOR_BUILTIN_ASSET_REGEX;
  if (objectType === "trim_accessory_object" || hasFinishCarpentryScopeSignals(analysis)) return TRIM_ACCESSORY_OBJECT_REGEX;
  if (objectType === "panel_closure_object") return PANEL_CLOSURE_OBJECT_REGEX;
  if (objectType === "framed_opening_object") return FRAMED_OPENING_OBJECT_REGEX;
  if (objectType === "opening_assembly") return OPENING_ASSEMBLY_OBJECT_REGEX;
  if (objectType === "anchored_object") return ANCHORED_ASSEMBLY_OBJECT_REGEX;
  if (objectType === "mounted_object") return MOUNTED_ASSEMBLY_OBJECT_REGEX;
  if (objectType === "repair_area") return /\bdrywall\b|\bwall\b|\bceiling\b|\bstucco(?:\s+finish|\s+cracks?)?\b|\bcurbs?\b|\bstorefront frame\b|\bopening\b/i;
  if (category) return resolveReplaceableAssetCategoryRegex(category);
  if (analysis?.siteEquipmentScope || analysis?.siteExteriorContext || hasCorpusMatch(analysis, SITE_HARDWARE_ASSET_REGEX)) return SITE_HARDWARE_ASSET_REGEX;
  return null;
}

function resolvePreferredObjectPhrase(analysis = {}) {
  const matcher = resolvePreferredObjectMatcher(analysis);
  if (!matcher) return "";

  const phraseSources = uniqueList([
    ...(Array.isArray(analysis?.actionItemPhrases) ? analysis.actionItemPhrases : []),
    ...(Array.isArray(analysis?.items) ? analysis.items : []),
    analysis?.coreScopeText,
    analysis?.rawScopeText,
  ]).filter(Boolean);

  for (const source of phraseSources) {
    const phrase = extractMatchedScopePhrase(source, matcher);
    if (phrase && !PLACEHOLDER_TARGET_REGEX.test(phrase)) return phrase;
  }

  return "";
}

function resolvePerimeterContextTargetPhrase(analysis = {}) {
  const matcher = hasCorpusMatch(analysis, FRAME_PERIMETER_OBJECT_REGEX)
    ? FRAME_PERIMETER_OBJECT_REGEX
    : OPENING_PERIMETER_OBJECT_REGEX;
  const candidates = uniqueList([
    ...(Array.isArray(analysis?.quantityItemPairs) ? analysis.quantityItemPairs : []),
    ...(Array.isArray(analysis?.items) ? analysis.items : []),
    ...(Array.isArray(analysis?.actionItemPhrases) ? analysis.actionItemPhrases : []),
    resolvePreferredObjectPhrase(analysis),
    ...(Array.isArray(analysis?.locations) ? analysis.locations : []),
    analysis?.coreScopeText,
    analysis?.rawScopeText,
  ]).filter(Boolean);

  for (const source of candidates) {
    const phrase = extractMatchedScopePhrase(source, matcher);
    if (phrase && !PLACEHOLDER_TARGET_REGEX.test(phrase) && !PERIMETER_ACCESSORY_OBJECT_REGEX.test(phrase)) {
      return normalizeTargetPhrase(phrase) || "";
    }
  }

  return "";
}

function resolvePrimaryCommercialContext(analysis = {}) {
  const contexts = uniqueList(
    Array.isArray(analysis?.commercialContextSignals) && analysis.commercialContextSignals.length
      ? analysis.commercialContextSignals
      : resolveCommercialContextSignals(analysis)
  );
  return contexts[0] || "";
}

function resolveAccessCoordinationPhrase(analysis = {}) {
  const accessContext = String(analysis?.impliedAccessContext || "").trim();
  if (accessContext === "rooftop_access") return "Coordinate rooftop access or safe shutdown conditions as required";
  if (accessContext === "lift_access") return "Coordinate lift or suitable access equipment as required";
  if (accessContext === "safe_handling") return "Coordinate safe handling and protection of the surrounding work area as required";
  return "";
}

function buildScopedEnvironmentLine(analysis = {}, fallbackScope = "stated scope") {
  const primaryCommercialContext = resolvePrimaryCommercialContext(analysis);
  const location = Array.isArray(analysis?.locations) ? analysis.locations[0] : "";
  const scopeLabel = normalizeScopePhrase(fallbackScope || "stated scope") || "stated scope";
  const formattedContextLabel = /\b(?:area|room|wall|entry|stair)\b/i.test(primaryCommercialContext)
    ? primaryCommercialContext
    : `${primaryCommercialContext} area`;

  if (analysis?.siteExteriorContext) {
    return ensureSentence(`Keep the work within the identified site or exterior area and the ${scopeLabel}`);
  }
  if (primaryCommercialContext === "commercial kitchen") {
    return ensureSentence(`Keep the work within the identified commercial kitchen area and the ${scopeLabel}`);
  }
  if (primaryCommercialContext) {
    return ensureSentence(`Keep the work within the identified ${formattedContextLabel} and the ${scopeLabel}`);
  }
  if (location && /\bhotel\b|\bwarehouse\b|\boffice\b|\blobby\b|\brestroom\b|\bkitchen\b|\bstorefront\b/i.test(location)) {
    return ensureSentence(`Keep the work within the identified ${location} area and the ${scopeLabel}`);
  }
  return "";
}

function resolveUniversalScopeTargetPhrase(analysis = {}) {
  const preferredObjectPhrase = resolvePreferredObjectPhrase(analysis);
  const objectType = analysis?.objectType || resolveObjectType(analysis);
  const hardwareCandidates = uniqueList([
    ...(Array.isArray(analysis?.quantityItemPairs) ? analysis.quantityItemPairs : []),
    ...(Array.isArray(analysis?.items) ? analysis.items : []),
    ...(Array.isArray(analysis?.actionItemPhrases) ? analysis.actionItemPhrases : []),
    preferredObjectPhrase,
    analysis?.coreScopeText,
    analysis?.rawScopeText,
  ]).filter(Boolean);
  for (const source of hardwareCandidates) {
    const hardwareTarget = extractMatchedScopePhrase(source, DOOR_HARDWARE_ASSET_REGEX);
    if (hardwareTarget && !PLACEHOLDER_TARGET_REGEX.test(hardwareTarget)) {
      return normalizeTargetPhrase(hardwareTarget) || "described scope item";
    }
  }
  if (hasCorpusMatch(analysis, DOOR_HARDWARE_ASSET_REGEX)) {
    for (const source of hardwareCandidates) {
      const hardwareTarget = extractMatchedScopePhrase(source, DOOR_HARDWARE_ASSET_REGEX);
      if (hardwareTarget && !PLACEHOLDER_TARGET_REGEX.test(hardwareTarget)) {
        return normalizeTargetPhrase(hardwareTarget) || "described scope item";
      }
    }
    const hardwareTarget = pickPreferredTargetCandidate(
      hardwareCandidates.filter((candidate) => DOOR_HARDWARE_ASSET_REGEX.test(candidate))
    ) || pickPreferredTargetCandidate(hardwareCandidates);
    if (hardwareTarget) return normalizeTargetPhrase(hardwareTarget) || "described scope item";
  }
  if (objectType === "hardware_component" || hasCorpusMatch(analysis, MINOR_HARDWARE_COMPONENT_REGEX)) {
    for (const source of hardwareCandidates) {
      const componentTarget = extractMatchedScopePhrase(source, MINOR_HARDWARE_COMPONENT_REGEX);
      if (componentTarget && !PLACEHOLDER_TARGET_REGEX.test(componentTarget)) {
        return normalizeTargetPhrase(componentTarget) || "described scope item";
      }
    }
  }
  const candidates = uniqueList([
    ...(Array.isArray(analysis?.quantityItemPairs) ? analysis.quantityItemPairs : []),
    ...(Array.isArray(analysis?.items) ? analysis.items : []),
    ...(Array.isArray(analysis?.actionItemPhrases) ? analysis.actionItemPhrases : []),
    preferredObjectPhrase,
    ...(Array.isArray(analysis?.locations) ? analysis.locations : []),
    analysis?.coreScopeText,
    resolvePrimaryScopePhrase(analysis),
  ]).filter(Boolean);

  const primary = candidates.find((value) => (
    OPENING_ASSEMBLY_OBJECT_REGEX.test(value)
    || PANEL_CLOSURE_OBJECT_REGEX.test(value)
    || TRIM_ACCESSORY_OBJECT_REGEX.test(value)
    || ANCHORED_ASSEMBLY_OBJECT_REGEX.test(value)
    || MOUNTED_ASSEMBLY_OBJECT_REGEX.test(value)
  )) || pickPreferredTargetCandidate(candidates) || "described scope item";

  return normalizeTargetPhrase(primary) || "described scope item";
}

function resolveUniversalVerificationPhrase(plan = {}) {
  if (["framed_opening_object", "opening_assembly"].includes(plan.objectType)) return "verify fit and operation where applicable";
  if (plan.objectType === "panel_closure_object") return "verify fit and secure closure within the stated scope";
  if (plan.objectType === "built_in_assembly") return "verify fit, alignment, and operation where applicable";
  if (["mounted_object", "anchored_object", "site_exterior_asset"].includes(plan.objectType)) return "verify alignment and securement where applicable";
  if (plan.objectType === "hardware_component") {
    return plan.connectionModel === "perimeter_closure"
      ? "adjust for fit, closure, and proper operation where applicable"
      : "adjust for fit and proper operation where applicable";
  }
  if (["utility_service", "electrical_terminations", "water_gas_drain_vent"].includes(plan.connectionModel)) return "verify operation where applicable";
  return "";
}

function resolveUniversalBoundarySentence(plan = {}, analysis = {}) {
  const explicitExclusion = firstSkeletonValue(analysis, "exclusions", "certain");
  const fallbackExclusion = firstSkeletonValue(analysis, "exclusions", "riskyMissing");
  if (explicitExclusion || fallbackExclusion) return renderExclusionSentence(explicitExclusion || fallbackExclusion);

  if (plan.connectionModel === "perimeter_closure") {
    if (analysis?.impliedAccessContext === "rooftop_access" || hasCorpusMatch(analysis, /\bskylights?\b|\broof hatches?\b/i)) {
      return renderExclusionSentence("substrate correction, concealed damage, roofing integration, and flashing or sealant work beyond the direct described scope are not included unless identified and approved");
    }
    return renderExclusionSentence("framing correction, concealed damage, perimeter sealant or flashing integration, and finish repairs beyond the direct described scope are not included unless identified and approved");
  }
  if (plan.objectType === "trim_accessory_object") {
    return renderExclusionSentence("substrate correction, concealed damage, and paint or finish work beyond the direct trim or accessory scope are not included unless identified and approved");
  }
  if (["mounted_object", "anchored_object", "site_exterior_asset"].includes(plan.objectType)) {
    return renderExclusionSentence("structural backing correction, anchorage repair, concrete or base restoration, and finish repairs beyond the direct described scope are not included unless identified and approved");
  }
  if (plan.objectType === "panel_closure_object") {
    return renderExclusionSentence("framing correction, concealed damage, and finish or sealant repairs beyond the direct panel or closure scope are not included unless identified and approved");
  }
  if (plan.objectType === "hardware_component") {
    return renderExclusionSentence("frame correction, concealed damage, and finish repairs beyond the direct component scope are not included unless identified and approved");
  }

  return renderExclusionSentence("concealed damage, substrate correction, and work beyond the direct described scope are not included unless identified and approved");
}

function resolveUniversalScopePlan(analysis = {}) {
  const primaryActionFamily = analysis?.primaryActionFamily || resolvePrimaryActionFamily(analysis);
  const objectType = analysis?.objectType || resolveObjectType(analysis);
  const connectionModel = analysis?.connectionModel || resolveConnectionModel({ ...analysis, objectType });
  const assemblyScale = analysis?.assemblyScale || resolveAssemblyScale({ ...analysis, objectType });
  const boundaryRiskHints = Array.isArray(analysis?.boundaryRiskHints) ? analysis.boundaryRiskHints : resolveBoundaryRiskHints({
    ...analysis,
    objectType,
    connectionModel,
  });
  const strongNamedMatch = hasStrongNamedFamilyMatch({
    ...analysis,
    objectType,
    connectionModel,
    assemblyScale,
    boundaryRiskHints,
  });

  if (!primaryActionFamily || strongNamedMatch) {
    return { eligible: false, lines: [] };
  }

  const target = resolveUniversalScopeTargetPhrase(analysis);
  const location = Array.isArray(analysis?.locations) ? analysis.locations[0] : "";
  const accessPhrase = resolveAccessCoordinationPhrase(analysis);
  const replacementScope = primaryActionFamily === "replace_changeout";
  const removalScope = primaryActionFamily === "remove_demo" && !replacementScope;
  const installScope = primaryActionFamily === "install_add_mount" && !replacementScope && !removalScope;
  const repairScope = primaryActionFamily === "repair_patch";
  const finishScope = primaryActionFamily === "finish_coating";
  const holeCreationIntent = normalizeScopePhrase(analysis?.holeCreationIntent || "");
  const connectionMethodHints = Array.isArray(analysis?.connectionMethodHints) ? analysis.connectionMethodHints : [];
  const perimeterScopeHints = Array.isArray(analysis?.perimeterScopeHints) ? analysis.perimeterScopeHints : [];
  const partialScopeHints = Array.isArray(analysis?.partialScopeHints) ? analysis.partialScopeHints : [];
  const openingClosureHints = Array.isArray(analysis?.openingClosureHints) ? analysis.openingClosureHints : [];
  const waterDamageRepairHints = Array.isArray(analysis?.waterDamageRepairHints) ? analysis.waterDamageRepairHints : [];
  const resetIntent = String(analysis?.resetIntent || "").trim();
  const adjacentMakeGoodScope = hasMidLevelAdjacentMakeGoodScope(analysis);
  const flashingMethodScope = Array.isArray(analysis?.fieldSlangMethodHints) && analysis.fieldSlangMethodHints.includes("perimeter_flashing");
  const closeUpOpeningScope = openingClosureHints.includes("close_up_scope")
    && (openingClosureHints.includes("opening_closure") || hasCorpusMatch(analysis, /\bopening\b/i));
  const resetScope = Boolean(resetIntent);
  const sealantScope = hasCorpusMatch(analysis, /\bsealant\b|\bcaulk\b/i);
  const perimeterContextTarget = resolvePerimeterContextTargetPhrase(analysis);
  const normalizedTarget = (replacementScope || removalScope) && !/\bexisting\b|\bnew\b|\bdamaged\b/i.test(target)
    ? `existing ${target}`
    : target;
  const includeLocationSuffix = location && !new RegExp(`\\b${location.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(normalizedTarget);
  const directLocationSuffix = includeLocationSuffix ? buildLocationSuffix(location) : "";

  let directLine = repairScope
    ? ensureSentence(`Repair ${target}${directLocationSuffix}`)
    : replacementScope
      ? ensureSentence(`Remove and replace ${normalizedTarget}${directLocationSuffix}`)
      : removalScope
        ? ensureSentence(`Remove ${normalizedTarget}${directLocationSuffix}`)
        : ensureSentence(`Install ${target}${directLocationSuffix}`);

  if (resetScope) {
    directLine = ensureSentence(
      `${resetIntent === "temporary_remove_reinstall" ? "Temporarily remove and reinstall" : "Remove and reinstall"} ${normalizedTarget}${directLocationSuffix}`
    );
  } else if (replacementScope && sealantScope && connectionModel === "perimeter_closure") {
    directLine = ensureSentence(
      perimeterContextTarget
        ? `Remove and replace failed sealant around ${perimeterContextTarget}`
        : "Remove and replace failed sealant within the stated perimeter scope"
    );
  } else if (finishScope && connectionModel === "perimeter_closure") {
    if (replacementScope && sealantScope) {
      directLine = ensureSentence(`Remove and replace ${normalizedTarget}${directLocationSuffix}`);
    } else if (flashingMethodScope || hasCorpusMatch(analysis, /\bflash(?:ed|ing)?(?:\s+around)?\b/i)) {
      directLine = ensureSentence(`Flash around ${perimeterContextTarget || `${target}${directLocationSuffix}`}`);
    } else {
      directLine = ensureSentence(
        perimeterContextTarget
          ? `${sealantScope ? "Caulk" : "Seal"} around ${perimeterContextTarget}`
          : sealantScope
            ? "Caulk the stated perimeter area"
            : `Seal around ${target}${directLocationSuffix}`
      );
    }
  } else if (finishScope && connectionModel === "finish_only_attachment") {
    directLine = ensureSentence(`Touch up ${target}${directLocationSuffix}`);
  } else if (closeUpOpeningScope) {
    directLine = ensureSentence(`Close up ${/\bopening\b/i.test(normalizedTarget) ? normalizedTarget : "opening"}${directLocationSuffix}`);
  }

  let processCore = "complete the described scope and clean up the work area";
  if (resetScope) {
    processCore = resetIntent === "temporary_remove_reinstall"
      ? `detach the described item as needed for access or adjacent repair, protect components within the stated scope, reinstall and secure the existing item after repair work is complete${adjacentMakeGoodScope ? ", complete minor adjacent wall or finish make-good where directly affected" : ""}, and clean up the work area`
      : `remove the described item as needed, protect and store reusable components within the stated scope, reinstall and secure the existing item, verify fit and attachment${adjacentMakeGoodScope ? ", complete minor adjacent wall or finish make-good where directly affected" : ""}, and clean up the work area`;
  } else if (replacementScope && sealantScope && connectionModel === "perimeter_closure") {
    processCore = "remove loose or failed perimeter sealant as required, install replacement sealant within the stated perimeter scope, tool and finish transitions as needed, and clean up the work area";
  } else if (finishScope && connectionModel === "perimeter_closure") {
    processCore = replacementScope && sealantScope
      ? "remove loose or failed perimeter sealant as required, install replacement sealant within the stated perimeter scope, tool and finish transitions as needed, and clean up the work area"
      : (
        flashingMethodScope || hasCorpusMatch(analysis, /\bflash(?:ed|ing)?(?:\s+around)?\b/i)
          ? "prepare adjacent perimeter surfaces as needed, complete perimeter flashing or weatherproofing tie-in within the stated scope, and clean up the work area"
          : "prepare adjacent perimeter surfaces and transitions as needed, along with affected areas as needed, complete sealant or weatherproofing tie-in within the stated scope, and clean up the work area"
      );
  } else if (closeUpOpeningScope) {
    processCore = openingClosureHints.includes("framed_closure_support")
      ? "frame or back the opening as required within the stated scope, patch and close the opening, blend adjacent finishes as needed, and clean up the work area"
      : "patch and close the opening within the stated scope, blend adjacent finishes as needed, and clean up the work area";
  } else if (connectionModel === "perimeter_closure") {
    if (objectType === "panel_closure_object") {
      processCore = replacementScope
        ? "remove accessible fasteners or closure components required for the replacement, fit and secure the replacement panel or closure assembly, complete required perimeter sealant or closure work within the stated scope, and clean up the work area"
        : removalScope
          ? "remove accessible fasteners or closure components required for safe removal, protect the surrounding opening or work area as needed within the stated scope, and clean up the work area"
          : installScope
            ? "lay out and secure the described panel or closure components, complete required perimeter attachment, sealant, or closure work within the stated scope, and clean up the work area"
            : "complete required panel closure fit-up and cleanup within the stated scope";
    } else {
      processCore = replacementScope
        ? "remove accessible fasteners, trim, sealant, or closure components required for the replacement, set and secure the replacement assembly, complete required perimeter closure, sealant, flashing, or trim tie-in within the stated scope, and clean up the work area"
        : removalScope
          ? "remove accessible fasteners, trim, sealant, or closure components required for safe removal, protect the surrounding opening or work area as needed within the stated scope, and clean up the work area"
          : installScope
            ? "lay out and secure the described assembly, complete required perimeter attachment, sealant, flashing, or closure work within the stated scope, and clean up the work area"
            : "complete required perimeter closure, fit-up, and cleanup within the stated scope";
    }
  } else if (connectionModel === "anchorage_fasteners") {
    processCore = replacementScope
      ? "remove accessible fasteners or anchorage required for the replacement, set and secure the replacement assembly, align components as required, and clean up the work area"
      : removalScope
        ? "remove accessible fasteners or anchorage required for safe removal, remove and dispose of removed materials, and clean up the work area"
        : installScope
          ? "lay out attachment points, secure the described assembly, align components as required, and clean up the work area"
          : "complete required anchorage, alignment, and cleanup within the stated scope";
  } else if (connectionModel === "finish_only_attachment") {
    processCore = replacementScope
      ? "remove accessible attachment points, install and secure replacement trim or accessory components, complete required caulk or finish tie-in as applicable, and clean up the work area"
      : removalScope
        ? "remove accessible attachment points required for safe removal, remove and dispose of removed materials, and clean up the work area"
        : installScope
          ? "lay out and secure the described trim or accessory components, complete required caulk or finish tie-in as applicable, and clean up the work area"
          : "complete required fit-up and finish tie-in within the stated scope";
  } else if (repairScope) {
    processCore = "prepare the affected area as needed, complete the described repair or correction, and clean up the work area";
    if (openingClosureHints.includes("close_up_scope") && /\bopening\b/i.test(`${target} ${analysis?.coreScopeText || ""}`)) {
      processCore = openingClosureHints.includes("framed_closure_support")
        ? "frame or back the opening as required within the stated scope, patch and close the opening, blend adjacent finishes as needed, and clean up the work area"
        : "patch and close the opening within the stated scope, blend adjacent finishes as needed, and clean up the work area";
    } else if (waterDamageRepairHints.length) {
      processCore = "prepare visibly leak- or moisture-damaged areas as needed, complete localized repair within the stated scope, blend adjacent finishes as applicable, and clean up the work area";
    } else if (perimeterScopeHints.includes("adjacent_finish_repair")) {
      processCore = "prepare adjacent perimeter surfaces as needed, complete localized patching or repair within the stated scope, blend transitions as applicable, and clean up the work area";
    }
  } else {
    processCore = replacementScope
      ? "remove the existing item, fit and secure the replacement item, complete related attachment or adjustment as required, and clean up the work area"
      : removalScope
        ? "detach the described item as required for safe removal, remove and dispose of removed materials, and clean up the work area"
        : installScope
          ? "fit and secure the described item, complete related attachment or adjustment as required, and clean up the work area"
          : "complete the described scope and clean up the work area";
  }

  const verificationPhrase = resolveUniversalVerificationPhrase({
    objectType,
    connectionModel,
    assemblyScale,
  });
  if (verificationPhrase) {
    processCore = processCore.replace(/,?\s+and clean up the work area$/i, `, ${verificationPhrase}, and clean up the work area`);
  }
  const processClauses = [];
  if (holeCreationIntent) processClauses.push(holeCreationIntent);
  processClauses.push(processCore);
  if (connectionMethodHints.length) {
    processClauses.push(...connectionMethodHints);
  }
  if (partialScopeHints.length) {
    processClauses.push("keep the work limited to the affected section, side, corner, edge, or stated area");
  }
  processCore = joinPlainPhrases(mergeWorkflowClauses(processClauses));

  const processLine = accessPhrase
    ? ensureSentence(`${accessPhrase}, ${decapitalizePhrase(processCore)}`)
    : ensureSentence(capitalizePhrase(processCore));
  const environmentLine = (
    analysis?.siteExteriorContext
    || Array.isArray(analysis?.commercialContextSignals) && analysis.commercialContextSignals.length
    || analysis?.residentialContext
    || objectType === "framed_opening_object"
  )
    ? buildScopedEnvironmentLine(
      analysis,
      connectionModel === "perimeter_closure" ? "stated opening scope" : "stated scope"
    )
    : "";
  const qualifierLine = resolveUniversalBoundarySentence({
    objectType,
    connectionModel,
    assemblyScale,
    boundaryRiskHints,
  }, analysis);

  return {
    eligible: true,
    objectType,
    connectionModel,
    assemblyScale,
    boundaryRiskHints,
    lines: uniqueList([directLine, processLine, environmentLine, qualifierLine]).filter(Boolean),
  };
}

function buildUniversalScopeLines(analysis = {}) {
  const plan = resolveUniversalScopePlan(analysis);
  return plan.eligible ? plan.lines : [];
}

function resolvePaintingTargetPhrase(analysis) {
  const candidates = uniqueList([
    ...getSkeletonValues(analysis, "includedAreas", "certain"),
    ...(Array.isArray(analysis?.items) ? analysis.items : []),
    ...(Array.isArray(analysis?.locations) ? analysis.locations : []),
    ...(Array.isArray(analysis?.actionItemPhrases) ? analysis.actionItemPhrases : []),
    resolvePrimaryScopePhrase(analysis),
  ]).filter(Boolean);
  const primaryCommercialContext = resolvePrimaryCommercialContext(analysis);

  const primary = candidates.find((value) => looksLikePaintTarget(value)) || candidates[0] || "designated surfaces";
  const normalized = normalizeScopePhrase(primary);

  if (/\bhouse\b|\bhome\b/i.test(normalized)) return "designated house surfaces";
  if (/\binterior\b/i.test(normalized)) return "designated interior surfaces";
  if (/\bexterior walls?\b/i.test(normalized)) return "designated exterior wall surfaces";
  if (/\bbedrooms?\b/i.test(normalized)) return "designated bedroom surfaces";
  if (/\bbath(?:room)?\b|\brestroom\b/i.test(normalized)) return "designated bathroom surfaces";
  if (primaryCommercialContext === "commercial kitchen") return "identified commercial kitchen surfaces";
  if (/\blobby\b/i.test(normalized) || primaryCommercialContext === "lobby") return "identified lobby surfaces";
  if (/\bstorefront\b/i.test(normalized) || primaryCommercialContext === "storefront") return "identified storefront surfaces";
  if (/\bwarehouse\b/i.test(normalized) || primaryCommercialContext === "warehouse") return "identified warehouse surfaces";
  if (/\bkitchen\b/i.test(normalized)) return "designated kitchen surfaces";
  if (/\boffice\b/i.test(normalized)) return "designated office surfaces";
  if (/\bwalls?\b/i.test(normalized)) return "designated wall surfaces";
  if (/\bceilings?\b/i.test(normalized)) return "designated ceiling surfaces";
  if (/\btrim\b/i.test(normalized)) return "designated trim surfaces";
  if (/\bdoors?\b/i.test(normalized)) return "designated door surfaces";
  if (/\bbaseboards?\b/i.test(normalized)) return "designated baseboard surfaces";
  return normalized || "designated surfaces";
}

function resolvePrimaryAction(analysis) {
  const actions = Array.isArray(analysis?.actions) ? analysis.actions : [];
  return actions[0] || (analysis?.mentionsPatchOrRepair ? "repair" : "work on");
}

function resolvePrimaryScopePhrase(analysis) {
  if (Array.isArray(analysis?.quantityItemPairs) && analysis.quantityItemPairs.length) return analysis.quantityItemPairs[0];
  if (Array.isArray(analysis?.items) && analysis.items.length) return analysis.items[0];
  return "affected areas";
}

function buildDirectScopeLine(analysis) {
  const action = resolvePrimaryAction(analysis);
  const actionLabel = capitalizePhrase(action === "work on" ? "Work on" : action);
  const primaryPhrase = resolvePrimaryScopePhrase(analysis);
  const location = Array.isArray(analysis?.locations) ? analysis.locations[0] : "";
  const uncertaintyQualifier = (Array.isArray(analysis?.uncertaintyPhrases) ? analysis.uncertaintyPhrases : [])
    .find((value) => ["as needed", "if needed", "if required", "as required", "where required", "where needed"].includes(value));

  return ensureSentence(
    `${actionLabel} ${primaryPhrase}${uncertaintyQualifier ? ` ${uncertaintyQualifier}` : ""}${buildLocationSuffix(location)}`
  );
}

function buildRepairScopeLine(analysis) {
  const actions = Array.isArray(analysis?.actions) ? analysis.actions : [];
  const hasRepairLine = actions.includes("patch") || actions.includes("repair");
  if (!hasRepairLine) return "";

  const repairVerb = actions.includes("patch") ? "Patch" : "Repair";
  const itemHint = (Array.isArray(analysis?.items) ? analysis.items : []).find((item) => /\bdrywall\b|\bwall\b|\bceiling\b|\bsurface\b/i.test(item))
    || "affected areas";
  const location = Array.isArray(analysis?.locations) ? analysis.locations[0] : "";
  const repairTail = /\baccess\b/i.test(location)
    ? " where required after access work is completed"
    : " where required";

  return ensureSentence(`${repairVerb} ${itemHint}${repairTail}`);
}

function buildContingencyScopeLine(analysis) {
  if (!hasRiskAwareScopeSignals(analysis)) return "";

  const concise = analysis?.brevityIntent === "concise";
  const professional = Array.isArray(analysis?.rewriteIntents) && analysis.rewriteIntents.includes("professionalize");
  const triggers = Array.isArray(analysis?.riskTriggerTerms) ? analysis.riskTriggerTerms : [];
  const mentionsConcealed = triggers.some((term) => ["hidden damage", "concealed damage", "unknown conditions", "existing conditions"].includes(term));

  if (mentionsConcealed) {
    return ensureSentence(
      professional || !concise
        ? "Additional concealed or existing-condition work is not included unless identified and approved"
        : "Additional concealed work is not included unless discovered and approved"
    );
  }

  return ensureSentence(
    professional || !concise
      ? "Additional concealed damage beyond accessible work areas is not included unless identified and approved"
      : "Additional concealed damage beyond accessible areas is not included unless discovered and approved"
  );
}

function joinClausesAsSentence(lines) {
  const clauses = (Array.isArray(lines) ? lines : [])
    .map((line) => asText(line).replace(/[.]+$/g, "").trim())
    .filter(Boolean);
  if (!clauses.length) return "";
  if (clauses.length === 1) return ensureSentence(clauses[0]);
  if (clauses.length === 2) return ensureSentence(`${clauses[0]}, and ${clauses[1].charAt(0).toLowerCase()}${clauses[1].slice(1)}`);
  const last = clauses.pop();
  return ensureSentence(`${clauses.join(", ")}, and ${last.charAt(0).toLowerCase()}${last.slice(1)}`);
}

function splitScopeNoteSentences(text) {
  const normalized = sanitizeScopeAssistText(text)
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return [];

  return (normalized.match(/[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g) || [])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function classifyDefaultScopeNoteLine(text) {
  const normalized = normalizeInstructionSpacing(text).toLowerCase();
  if (!normalized) return "scope";

  if (
    /\bnot included\b|\bunless\b|\bexclude\b|\bexcluded\b|\bsubject to\b|\boutside the\b|\bbeyond\b|\ballowance\b|\badditional\b/i.test(normalized)
  ) {
    return "qualifier";
  }

  if (
    /\btest\b|\bverify\b|\bclean up\b|\bcleanup\b|\bcoord(?:inate|ination)\b|\baccess\b|\bshutdown\b|\blabel(?:ing)?\b|\bidentification\b|\bfit-up\b|\balignment\b|\bterminations?\b|\brouting\b|\broute\b|\bsupports?\b|\bbends?\b|\breconnect\b|\bprepare\b|\bprep\b|\bprotect\b|\bsand\b|\bleave ready\b/i.test(normalized)
  ) {
    return "operations";
  }

  return "scope";
}

function shouldUseDefaultContractorBlocks(lines, analysis = {}) {
  if (analysis?.formattingIntent) return false;

  const normalizedLines = (Array.isArray(lines) ? lines : [])
    .map((line) => ensureSentence(line))
    .filter(Boolean);
  if (normalizedLines.length < 2) return false;

  const tokenCount = toComparableScopeTokens(normalizedLines.join(" ")).length;
  const qualifierCount = normalizedLines.filter((line) => classifyDefaultScopeNoteLine(line) === "qualifier").length;
  const operationsCount = normalizedLines.filter((line) => classifyDefaultScopeNoteLine(line) === "operations").length;

  if (normalizedLines.length >= 4 && tokenCount >= 30) return true;
  if (normalizedLines.length === 3 && qualifierCount > 0 && operationsCount > 0 && tokenCount >= 42) return true;
  if (normalizedLines.length === 2 && qualifierCount > 0 && tokenCount >= 44) return true;
  return false;
}

function formatDefaultContractorBlocks(lines, analysis = {}) {
  const normalizedLines = (Array.isArray(lines) ? lines : [])
    .map((line) => ensureSentence(line))
    .filter(Boolean);
  if (!normalizedLines.length) return "";
  if (!shouldUseDefaultContractorBlocks(normalizedLines, analysis)) return normalizedLines.join(" ");

  const blocks = [];
  let currentBlock = [];
  let currentKind = "";

  normalizedLines.forEach((line, index) => {
    const kind = classifyDefaultScopeNoteLine(line);
    const previousKind = currentKind;
    const forceBreak = index > 0 && (
      (kind === "qualifier" && previousKind !== "qualifier")
      || (kind === "operations" && previousKind === "scope")
      || (kind === "scope" && previousKind === "operations")
    );
    const lengthBreak = currentBlock.length >= 2 && kind === previousKind && kind !== "qualifier" && blocks.length < 3;

    if (forceBreak || lengthBreak) {
      blocks.push(currentBlock.join(" "));
      currentBlock = [line];
      currentKind = kind;
      return;
    }

    currentBlock.push(line);
    currentKind = kind;
  });

  if (currentBlock.length) blocks.push(currentBlock.join(" "));

  if (blocks.length <= 1) return normalizedLines.join(" ");
  if (blocks.length > 4) {
    return [
      blocks[0],
      blocks.slice(1, -1).join(" "),
      blocks[blocks.length - 1],
    ].filter(Boolean).join("\n\n");
  }

  return blocks.join("\n\n");
}

function formatDefaultContractorScopeNotes(text, analysis = {}) {
  const normalized = sanitizeScopeAssistText(text);
  if (!normalized) return "";
  if (analysis?.formattingIntent) return normalized;
  if (/\n\n/.test(normalized)) return normalized;
  if (/^[-*•]\s+|^\d+\.\s+/m.test(normalized)) return normalized;

  const lines = splitScopeNoteSentences(normalized);
  const formatted = formatDefaultContractorBlocks(lines, analysis);
  return formatted || normalized;
}

function formatScopeLines(lines, analysis = {}) {
  const normalizedLines = uniqueList(lines).filter(Boolean);
  if (!normalizedLines.length) return "";
  const format = analysis?.formattingIntent || "";
  if (format === "bullets") return normalizedLines.map((line) => `- ${line.replace(/^[-*•]\s+/, "")}`).join("\n");
  if (format === "numbered_list") return normalizedLines.map((line, index) => `${index + 1}. ${line.replace(/^\d+\.\s+/, "")}`).join("\n");
  if (format === "sentence") return joinClausesAsSentence(normalizedLines);

  if (format === "paragraph") {
    const paragraphLines = analysis?.brevityIntent === "concise" ? normalizedLines.slice(0, 3) : normalizedLines;
    return paragraphLines.join(" ");
  }

  return formatDefaultContractorBlocks(normalizedLines, analysis);
}

function buildGenericScopeLines(analysis) {
  const certainWork = getSkeletonValues(analysis, "directWork", "certain").map(normalizeScopePhrase);
  const impliedWork = getSkeletonValues(analysis, "directWork", "implied").map(normalizeScopePhrase);
  const prep = getSkeletonValues(analysis, "prepRequirements", "certain")
    .concat(getSkeletonValues(analysis, "prepRequirements", "implied"))
    .map(normalizeScopePhrase);
  const completion = getSkeletonValues(analysis, "completionStandards", "certain")
    .concat(getSkeletonValues(analysis, "completionStandards", "implied"))
    .map(normalizeScopePhrase);
  const exclusions = getSkeletonValues(analysis, "exclusions", "certain")
    .concat(getSkeletonValues(analysis, "exclusions", "riskyMissing"))
    .map(normalizeScopePhrase);
  const location = Array.isArray(analysis?.locations) ? analysis.locations[0] : "";
  const roughPrompt = isShortRoughScopePrompt(analysis?.coreScopeText || analysis?.rawScopeText, analysis);
  const strongSignalFallback = hasRoofingScopeSignals(analysis)
    || hasRiskAwareScopeSignals(analysis)
    || hasTechnicalScopeSignals(analysis)
    || hasFinishCarpentryScopeSignals(analysis)
    || hasFinishCoatingScopeSignals(analysis)
    || hasRepairPatchScopeSignals(analysis)
    || hasReplaceableAssetScopeSignals(analysis)
    || hasScopeExpansionSignals(analysis)
    || resolveUniversalScopePlan(analysis).eligible;

  const directParts = uniqueList([
    ...certainWork,
    ...impliedWork.filter((value) => /\breconnect supply lines?\b/i.test(value)),
  ]).filter(Boolean);

  if (!directParts.length && location) {
    directParts.push(`${resolvePrimaryAction(analysis)} ${resolvePrimaryScopePhrase(analysis)}${buildLocationSuffix(location)}`);
  }

  const primaryLine = directParts.length
    ? ensureSentence(`${capitalizePhrase(joinPlainPhrases(directParts))}${location && !new RegExp(`\\b${location.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(directParts[0]) ? buildLocationSuffix(location) : ""}`)
    : buildDirectScopeLine(analysis);

  const processLine = uniqueList([
    ...prep,
    ...completion.filter((value) => !/\bclean up work area\b/i.test(value) || completion.length === 1),
  ]).length
    ? ensureSentence(capitalizePhrase(joinPlainPhrases(uniqueList([
      ...prep,
      ...completion,
    ]).slice(0, analysis?.brevityIntent === "concise" ? 2 : 3))))
    : (roughPrompt && !strongSignalFallback
      ? ensureSentence(
        hasRiskAwareScopeSignals(analysis)
          ? "Complete the described scope, verify fit or operation where applicable, and clean up the work area"
          : "Complete the described scope and clean up the work area"
      )
      : "");

  const qualifierLine = exclusions[0]
    ? renderExclusionSentence(exclusions[0])
    : (roughPrompt && !strongSignalFallback
      ? renderExclusionSentence("concealed damage, substrate correction, and work beyond the direct described scope are not included unless identified and approved")
      : buildContingencyScopeLine(analysis));

  return uniqueList([primaryLine, processLine, qualifierLine]).filter(Boolean);
}

function buildSignalDrivenFallbackLines(analysis = {}) {
  if (hasRoofingScopeSignals(analysis)) return buildRoofingScopeLines(analysis);

  const universalLines = buildUniversalScopeLines(analysis);
  if (universalLines.length) return universalLines;

  if (hasRiskAwareScopeSignals(analysis)) return buildRiskAwareScopeLines(analysis);

  return [];
}

function buildToiletScopeLines(analysis) {
  const quantityPhrase = (Array.isArray(analysis?.quantityItemPairs) ? analysis.quantityItemPairs : []).find((value) => /\btoilet(?:s)?\b/i.test(value))
    || "existing toilet";
  const location = Array.isArray(analysis?.locations) ? analysis.locations[0] : "";
  const directParts = [
    `Remove and replace ${quantityPhrase}${buildLocationSuffix(location)}`,
    "install required wax rings and closet bolts",
    "reconnect supply lines",
  ];
  const explicitExclusion = firstSkeletonValue(analysis, "exclusions", "certain");
  const fallbackExclusion = firstSkeletonValue(analysis, "exclusions", "riskyMissing");

  return uniqueList([
    ensureSentence(joinPlainPhrases(directParts)),
    ensureSentence(
      analysis?.brevityIntent === "concise"
        ? "Test for proper operation"
        : "Test for proper operation and clean up the work area"
    ),
    renderExclusionSentence(explicitExclusion || fallbackExclusion),
  ]).filter(Boolean);
}

function buildDrywallScopeLines(analysis) {
  const hasDemo = (Array.isArray(analysis?.actions) ? analysis.actions : []).includes("demo");
  const location = Array.isArray(analysis?.locations) ? analysis.locations[0] : "";
  const explicitExclusion = firstSkeletonValue(analysis, "exclusions", "certain");
  const fallbackExclusion = firstSkeletonValue(analysis, "exclusions", "riskyMissing");

  if (hasDemo && /\baccess\b/i.test(location)) {
    return uniqueList([
      ensureSentence(`Demo damaged drywall as needed${buildLocationSuffix(location)}`),
      ensureSentence("Patch damaged drywall where required after access work is completed"),
      renderExclusionSentence(explicitExclusion || buildContingencyScopeLine(analysis) || "additional concealed damage beyond accessible work areas is not included unless identified and approved"),
    ]).filter(Boolean);
  }

  return uniqueList([
    ensureSentence(`Patch affected drywall areas as needed${buildLocationSuffix(location)}, sand smooth, and leave ready for finish`),
    ensureSentence("Minor patching only"),
    renderExclusionSentence(explicitExclusion || fallbackExclusion),
  ]).filter(Boolean);
}

function buildPaintingScopeLines(analysis) {
  const actions = Array.isArray(analysis?.actions) ? analysis.actions : [];
  const target = resolvePaintingTargetPhrase(analysis);
  const preferredObjectPhrase = resolvePreferredObjectPhrase(analysis);
  const primaryCommercialContext = resolvePrimaryCommercialContext(analysis);
  const explicitExclusion = firstSkeletonValue(analysis, "exclusions", "certain");
  const fallbackExclusion = firstSkeletonValue(analysis, "exclusions", "riskyMissing");
  const repairAndPaintScope = actions.some((action) => ["patch", "repair"].includes(action));
  const partialScopeHints = Array.isArray(analysis?.partialScopeHints) ? analysis.partialScopeHints : [];
  const openingClosureHints = Array.isArray(analysis?.openingClosureHints) ? analysis.openingClosureHints : [];
  const waterDamageRepairHints = Array.isArray(analysis?.waterDamageRepairHints) ? analysis.waterDamageRepairHints : [];
  const perimeterScopeHints = Array.isArray(analysis?.perimeterScopeHints) ? analysis.perimeterScopeHints : [];
  const objectType = analysis?.objectType || resolveObjectType(analysis);
  const textureFinishScope = actions.includes("texture") || hasCorpusMatch(analysis, /\btexture(?:d|ing)?\b|\btexture match\b/i);
  const blendFinishScope = hasCorpusMatch(analysis, /\bblend(?:ed|ing)?\b/i);
  const adjacentMakeGoodScope = hasMidLevelAdjacentMakeGoodScope(analysis);
  const explicitMakeGoodScope = hasCorpusMatch(analysis, /\bmake\s+good\b/i);
  const repairTargetSource = `${preferredObjectPhrase} ${analysis?.coreScopeText || ""} ${target}`;
  const repairPaintTarget = /\bceiling\b/i.test(repairTargetSource)
    ? "affected ceiling areas"
    : /\bstucco\b/i.test(repairTargetSource)
      ? "affected stucco surfaces"
      : /\bwall\b/i.test(repairTargetSource)
        ? (/\bwall\b/i.test(target) ? target : "affected wall areas")
        : "affected areas";
  const repairFinishBlendPhrase = textureFinishScope
    ? "match texture as closely as practical"
    : blendFinishScope
      ? "blend the repaired finish as closely as practical"
      : "";
  const lowLevelMixedPaintTarget = normalizeScopePhrase(
    resolvePerimeterContextTargetPhrase(analysis)
    || preferredObjectPhrase
    || ""
  );
  const lowLevelMixedPaintScope = Boolean(
    lowLevelMixedPaintTarget
    && (
      perimeterScopeHints.length
      || ["hardware_component", "panel_closure_object", "trim_accessory_object", "framed_opening_object", "opening_assembly"].includes(objectType)
      || hasCorpusMatch(analysis, /\btrim\b|\bframe\b|\bpanel\b|\bbox\b|\bopening\b/i)
    )
  );
  const sealOrTouchUpScope = hasCorpusMatch(analysis, PERIMETER_SEAL_METHOD_REGEX);
  const prepLine = repairAndPaintScope
    ? ensureSentence(
      openingClosureHints.includes("old_opening") || openingClosureHints.includes("close_up_scope")
        ? "Patch and close the old opening within the stated wall area and prepare adjacent surfaces for finish"
        : (
          lowLevelMixedPaintScope
            ? (
              objectType === "trim_accessory_object"
                ? `Patch or make good around ${lowLevelMixedPaintTarget} as needed and prepare directly affected finish surfaces for paint`
                : `Patch or make good around ${lowLevelMixedPaintTarget} as needed and prepare adjacent surfaces for finish`
            )
            : (
          waterDamageRepairHints.length
            ? `Patch ${repairPaintTarget} damaged by water or leaks as needed${repairFinishBlendPhrase ? `, ${repairFinishBlendPhrase},` : ","} and prepare adjacent surfaces for finish`
            : explicitMakeGoodScope && adjacentMakeGoodScope
              ? `Make good the directly affected wall or finish area as needed${repairFinishBlendPhrase ? `, ${repairFinishBlendPhrase},` : ","} and prepare adjacent surfaces for finish`
              : `Patch ${repairPaintTarget} as needed${repairFinishBlendPhrase ? `, ${repairFinishBlendPhrase},` : ","} and prepare adjacent surfaces for finish`
            )
        )
    )
    : ensureSentence(
      lowLevelMixedPaintScope && sealOrTouchUpScope
        ? `Prepare ${lowLevelMixedPaintTarget} and adjacent perimeter surfaces as needed, complete localized sealant or make-good work within the stated scope, and protect nearby finished areas`
        : `Prepare ${target} as needed and protect adjacent areas`
    );
  const applyLine = ensureSentence(
    repairAndPaintScope
      ? (
        primaryCommercialContext
          ? "Apply paint to the identified repaired work area and perform minor masking and cleanup"
          : "Apply paint to the repaired work area and perform minor masking and cleanup"
      )
      : (
        primaryCommercialContext
          ? "Apply paint to the identified work area and perform minor masking and cleanup"
          : "Apply paint to the agreed work area and perform minor masking and cleanup"
      )
  );
  const environmentLine = buildScopedEnvironmentLine(analysis, "stated paint scope");
  const qualifierLine = renderExclusionSentence(
    explicitExclusion
      || (repairAndPaintScope ? "" : fallbackExclusion)
      || (
        repairAndPaintScope
          ? "extensive wall repair, concealed damage, and surfaces outside the direct patch and paint area are not included unless identified and approved"
          : (
            primaryCommercialContext
              ? "extensive surface repair, concealed damage, and surfaces outside the identified work area are not included unless identified and approved"
              : "extensive surface repair, concealed damage, and surfaces outside the agreed work area are not included unless identified and approved"
          )
      )
  );
  const localizedLine = partialScopeHints.length || perimeterScopeHints.length
    ? ensureSentence("Keep the work limited to the affected side, section, perimeter, or stated repair area")
    : "";

  return uniqueList([prepLine, applyLine, environmentLine, localizedLine, qualifierLine]).filter(Boolean);
}

function buildVanityScopeLines(analysis) {
  const actions = Array.isArray(analysis?.actions) ? analysis.actions : [];
  const location = Array.isArray(analysis?.locations) ? analysis.locations[0] : "";
  const explicitExclusion = firstSkeletonValue(analysis, "exclusions", "certain");
  const fallbackExclusion = firstSkeletonValue(analysis, "exclusions", "riskyMissing");
  const replacementScope = actions.includes("replace");
  const installationScope = !replacementScope && actions.includes("install");
  const repairScope = !replacementScope && !installationScope && (actions.includes("repair") || actions.includes("patch"));
  const adjacentMakeGoodScope = hasMidLevelAdjacentMakeGoodScope(analysis);
  const locationSuffix = buildLocationSuffix(location);

  const directLine = ensureSentence(
    replacementScope
      ? `Remove and replace vanity${locationSuffix}`
      : repairScope
        ? `Repair vanity${locationSuffix}`
        : `Install vanity${locationSuffix}`
  );
  const processLine = ensureSentence(
    repairScope
      ? (
        adjacentMakeGoodScope
          ? "Adjust, resecure, or repair accessible vanity components within the stated scope, complete minor adjacent wall make-good where directly affected, verify fit and operation where applicable, and clean up the work area"
          : "Adjust, resecure, or repair accessible vanity components within the stated scope, verify fit and operation where applicable, and clean up the work area"
      )
      : (
        adjacentMakeGoodScope
          ? "Lay out the described vanity, place, level, align, and secure the unit within the stated scope, complete minor adjacent wall make-good where directly affected, verify fit and operation where applicable, and clean up the work area"
          : "Lay out the described vanity, place, level, align, and secure the unit within the stated scope, verify fit and operation where applicable, and clean up the work area"
      )
  );
  const qualifierLine = renderExclusionSentence(
    explicitExclusion
      || fallbackExclusion
      || "countertop work, plumbing or electrical hookups, wall repair beyond direct attachment areas, and work outside the stated vanity scope are not included unless identified and approved"
  );

  return uniqueList([
    directLine,
    processLine,
    qualifierLine,
  ]).filter(Boolean);
}

function buildFinishCarpentryScopeLines(analysis) {
  const target = resolveFinishCarpentryTargetPhrase(analysis);
  const actions = Array.isArray(analysis?.actions) ? analysis.actions : [];
  const location = Array.isArray(analysis?.locations) ? analysis.locations[0] : "";
  const scopeAssetCategory = analysis?.scopeAssetCategory || resolveScopeAssetCategory(analysis);
  const partialScopeHints = Array.isArray(analysis?.partialScopeHints) ? analysis.partialScopeHints : [];
  const perimeterScopeHints = Array.isArray(analysis?.perimeterScopeHints) ? analysis.perimeterScopeHints : [];
  const mixedPatchScope = actions.includes("patch")
    || hasCorpusMatch(analysis, /\bpatch\b.*\bwall\b|\bpatch\b.*\bfinish\b/i);
  const adjacentMakeGoodScope = hasMidLevelAdjacentMakeGoodScope(analysis);
  const perimeterFollowupScope = hasMidLevelPerimeterFollowupScope(analysis) || perimeterScopeHints.includes("trim_transition_scope");
  const resetIntent = String(analysis?.resetIntent || "").trim();
  const explicitExclusion = firstSkeletonValue(analysis, "exclusions", "certain");
  const fallbackExclusion = firstSkeletonValue(analysis, "exclusions", "riskyMissing");
  const builtInScope = scopeAssetCategory === "interior_builtin" || INTERIOR_BUILTIN_ASSET_REGEX.test(target);
  const replacementScope = actions.includes("replace");
  const installationScope = !replacementScope && actions.includes("install");
  const repairScope = !replacementScope && !installationScope && (actions.includes("repair") || actions.includes("patch"));
  if (resetIntent) {
    const directLine = ensureSentence(
      `${resetIntent === "temporary_remove_reinstall" ? "Temporarily remove and reinstall" : "Remove and reinstall"} existing ${target}${buildLocationSuffix(location)}`
    );
    const processLine = ensureSentence(
      resetIntent === "temporary_remove_reinstall"
        ? "Detach the existing trim or accessory components as required for access or adjacent repair, protect reusable materials within the stated scope, reinstall and secure the existing components after repair is complete, verify fit and attachment, and clean up the work area"
        : "Remove the existing trim or accessory components as needed, protect and store reusable materials within the stated scope, reinstall and secure the existing components, verify fit and attachment, and clean up the work area"
    );
    const qualifierLine = renderExclusionSentence(
      explicitExclusion || fallbackExclusion || "wall repair beyond minor touch-up, floor repair, and final paint or stain touch-up are not included unless identified and approved"
    );
    return uniqueList([directLine, processLine, qualifierLine]).filter(Boolean);
  }
  if (builtInScope) {
    const caseworkExclusion = "countertops, plumbing or electrical hookups, wall repair beyond direct attachment areas, and work outside the stated casework scope are not included unless identified and approved";
    const localizedScopeClause = partialScopeHints.length
      ? "keeping the work limited to the affected run, section, side, edge, or stated casework area, "
      : "";
    const directLine = ensureSentence(
      replacementScope
        ? `Remove and replace ${target}${buildLocationSuffix(location)}`
        : repairScope
          ? `Repair ${target}${buildLocationSuffix(location)}`
          : `Install ${target}${buildLocationSuffix(location)}`
    );
    const processLine = ensureSentence(
      capitalizePhrase(
        repairScope
          ? `${localizedScopeClause}adjust, resecure, and repair accessible cabinet, shelving, casework, millwork, or built-in components within the stated scope, ${adjacentMakeGoodScope ? "complete minor adjacent wall or finish make-good where directly affected, " : ""}verify fit and operation where applicable, and clean up the work area`
          : `${localizedScopeClause}${replacementScope ? "remove the existing units as needed, " : ""}lay out the described cabinet, shelving, casework, millwork, or built-in units, place, level, align, and secure components within the stated scope, ${adjacentMakeGoodScope ? "complete minor adjacent wall or finish make-good where directly affected, " : ""}verify fit and operation where applicable, and clean up the work area`
      )
    );
    const qualifierLine = renderExclusionSentence(
      explicitExclusion
        || (/\bcountertop\b|\bcasework\b|\bplumbing\b|\belectrical\b|\battachment areas?\b/i.test(asText(fallbackExclusion))
          ? fallbackExclusion
          : caseworkExclusion)
    );
    return uniqueList([directLine, processLine, qualifierLine]).filter(Boolean);
  }
  const installVerb = actions.includes("replace")
    ? `Remove and replace ${target}`
    : actions.includes("patch") && !actions.includes("repair")
        ? `Touch up ${target}`
        : repairScope
          ? `Repair ${target}`
        : `Install ${target}`;
  const directLine = ensureSentence(`${installVerb}${buildLocationSuffix(location)}, fit and secure components as needed`);
  const processLine = ensureSentence(
    `${partialScopeHints.length ? "Limit work to the affected trim area, " : ""}${mixedPatchScope || adjacentMakeGoodScope ? "complete minor adjacent patching or finish tie-in where directly affected, " : ""}${perimeterFollowupScope ? "complete required trim, sealant, or transition tie-in within the stated scope, " : ""}make minor cuts and adjustments for fit, and clean up the work area`
  );
  const qualifierLine = renderExclusionSentence(
    explicitExclusion || fallbackExclusion || "wall repair beyond minor touch-up, floor repair, and final paint or stain touch-up are not included unless identified and approved"
  );

  return uniqueList([directLine, processLine, qualifierLine]).filter(Boolean);
}

function resolveFinishScopeTargetPhrase(analysis) {
  if (hasCorpusMatch(analysis, /\bceiling tiles?\b/i)) return "ceiling tile";
  if (hasCorpusMatch(analysis, /\bvct\b|\bvinyl composition tile\b/i)) return "vinyl composition tile";
  if (hasCorpusMatch(analysis, /\btile(?:s)?\b/i)) return "tile";

  const candidates = uniqueList([
    ...(Array.isArray(analysis?.quantityItemPairs) ? analysis.quantityItemPairs : []),
    ...(Array.isArray(analysis?.items) ? analysis.items : []),
    ...(Array.isArray(analysis?.actionItemPhrases) ? analysis.actionItemPhrases : []),
    analysis?.coreScopeText,
    resolvePrimaryScopePhrase(analysis),
  ]).filter(Boolean);

  const primary = candidates.find((value) => FINISH_SURFACE_ASSET_REGEX.test(value))
    || pickPreferredTargetCandidate(candidates)
    || "finish scope";
  return normalizeTargetPhrase(primary) || "finish scope";
}

function resolveFinishScopePlan(analysis) {
  const actions = Array.isArray(analysis?.actions) ? analysis.actions : [];
  const target = resolveFinishScopeTargetPhrase(analysis);
  const location = Array.isArray(analysis?.locations) ? analysis.locations[0] : "";
  const explicitExclusion = firstSkeletonValue(analysis, "exclusions", "certain");
  const fallbackExclusion = firstSkeletonValue(analysis, "exclusions", "riskyMissing");
  const accessPhrase = resolveAccessCoordinationPhrase(analysis);
  const includeLocationSuffix = location && !new RegExp(`\\b${location.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(target);
  const locationSuffix = includeLocationSuffix ? buildLocationSuffix(location) : "";
  let directLine = ensureSentence(`Install ${target}${locationSuffix}`);
  let processLine = ensureSentence("Complete required layout, fitting, finishing, and cleanup for the described scope");
  let environmentLine = buildScopedEnvironmentLine(analysis, "stated finish scope");
  let exclusion = explicitExclusion || fallbackExclusion || "substrate correction, concealed damage, and work outside the identified finish area are not included unless identified and approved";
  let directWorkHints = ["complete required layout and fitting for the described finish scope"];
  let completionHints = ["clean up the work area"];

  if (/\bfrp\b/i.test(target)) {
    directLine = ensureSentence(`Install ${target}${locationSuffix} and complete required layout, cuts, trim, and fastening for the described wall area`);
    processLine = ensureSentence("Prepare the receiving surface as needed for direct installation, complete sealant and finish transitions required for the panel system, and clean up the work area");
    environmentLine = buildScopedEnvironmentLine(analysis, "stated FRP wall panel scope");
    exclusion = explicitExclusion || fallbackExclusion || "wall repair, substrate correction, backing modifications, and work outside the identified panel area are not included unless identified and approved";
    directWorkHints = ["complete required layout, cuts, trim, and fastening for the described wall panel area"];
    completionHints = ["complete sealant and finish transitions required for the panel system", "clean up the work area"];
  } else if (/\bceiling tiles?\b/i.test(target)) {
    directLine = ensureSentence(
      `${actions.includes("replace") ? "Remove and replace" : "Install"} ${target}${locationSuffix} and fit replacement materials within the existing ceiling layout`
    );
    processLine = ensureSentence("Match the described ceiling area as closely as practical, leave the grid aligned within the stated scope, and clean up the work area");
    environmentLine = buildScopedEnvironmentLine(analysis, "stated ceiling tile scope");
    exclusion = explicitExclusion || fallbackExclusion || "ceiling grid repair, above-ceiling mechanical or electrical work, and concealed damage are not included unless identified and approved";
    directWorkHints = ["fit replacement ceiling materials within the existing layout"];
    completionHints = ["leave the grid aligned within the stated scope", "clean up the work area"];
  } else if (/\bvct\b|\bvinyl composition tile\b/i.test(target)) {
    directLine = ensureSentence(`Install ${target}${locationSuffix} including required layout, cuts, and setting for the described floor area`);
    processLine = ensureSentence("Prepare the receiving floor for direct installation as needed, complete rolling and cleanup, and leave the flooring ready for use");
    environmentLine = buildScopedEnvironmentLine(analysis, "stated flooring scope");
    exclusion = explicitExclusion || fallbackExclusion || "substrate leveling, moisture mitigation, and floor prep beyond direct installation are not included unless identified and approved";
    directWorkHints = ["complete required layout, cuts, and setting for the described floor area"];
    completionHints = ["leave the flooring ready for use", "clean up the work area"];
  }

  if (accessPhrase && /\bceiling\b|\bhigh[-\s]?bay\b/i.test(`${target} ${analysis?.coreScopeText || ""}`)) {
    processLine = ensureSentence(`${accessPhrase}, ${decapitalizePhrase(stripSentencePunctuation(processLine))}`);
  }

  return {
    directWorkHints,
    completionHints,
    exclusion,
    lines: uniqueList([directLine, processLine, environmentLine, renderExclusionSentence(exclusion)]).filter(Boolean),
  };
}

function buildFinishScopeLines(analysis) {
  return resolveFinishScopePlan(analysis).lines;
}

function resolveRepairScopeTargetPhrase(analysis) {
  const openingClosureHints = Array.isArray(analysis?.openingClosureHints) ? analysis.openingClosureHints : [];
  if (
    openingClosureHints.includes("opening_closure")
    || openingClosureHints.includes("close_up_scope")
    || hasCorpusMatch(analysis, /\bopenings?\b/i)
  ) {
    return "opening";
  }

  const preferredObjectPhrase = resolvePreferredObjectPhrase(analysis);
  const candidates = uniqueList([
    ...(Array.isArray(analysis?.quantityItemPairs) ? analysis.quantityItemPairs : []),
    ...(Array.isArray(analysis?.items) ? analysis.items : []),
    ...(Array.isArray(analysis?.actionItemPhrases) ? analysis.actionItemPhrases : []),
    preferredObjectPhrase,
    ...(Array.isArray(analysis?.locations) ? analysis.locations : []),
    analysis?.coreScopeText,
    resolvePrimaryScopePhrase(analysis),
  ]).filter(Boolean);

  const primary = candidates.find((value) => REPAIR_SURFACE_ASSET_REGEX.test(value))
    || pickPreferredTargetCandidate(candidates)
    || "affected areas";
  return normalizeTargetPhrase(primary) || "affected areas";
}

function resolveRepairScopePlan(analysis) {
  const actions = Array.isArray(analysis?.actions) ? analysis.actions : [];
  const target = resolveRepairScopeTargetPhrase(analysis);
  const location = Array.isArray(analysis?.locations) ? analysis.locations[0] : "";
  const scopeAssetCategory = analysis?.scopeAssetCategory || resolveScopeAssetCategory(analysis);
  const objectType = analysis?.objectType || resolveObjectType({ ...analysis, scopeAssetCategory });
  const perimeterScopeHints = Array.isArray(analysis?.perimeterScopeHints) ? analysis.perimeterScopeHints : [];
  const partialScopeHints = Array.isArray(analysis?.partialScopeHints) ? analysis.partialScopeHints : [];
  const openingClosureHints = Array.isArray(analysis?.openingClosureHints) ? analysis.openingClosureHints : [];
  const waterDamageRepairHints = Array.isArray(analysis?.waterDamageRepairHints) ? analysis.waterDamageRepairHints : [];
  const connectionMethodHints = Array.isArray(analysis?.connectionMethodHints) ? analysis.connectionMethodHints : [];
  const adjacentMakeGoodScope = hasMidLevelAdjacentMakeGoodScope(analysis);
  const finishFollowupScope = hasMidLevelFinishFollowupScope(analysis);
  const perimeterFollowupScope = hasMidLevelPerimeterFollowupScope(analysis);
  const securementFollowupScope = hasMidLevelSecurementFollowupScope(analysis);
  const closeUpOpeningScope = openingClosureHints.includes("close_up_scope")
    && (openingClosureHints.includes("opening_closure") || hasCorpusMatch(analysis, /\bopening\b/i));
  const explicitExclusion = firstSkeletonValue(analysis, "exclusions", "certain");
  const fallbackExclusion = firstSkeletonValue(analysis, "exclusions", "riskyMissing");
  const repairVerb = actions.includes("patch") ? "Patch" : "Repair";
  const textureFinishScope = actions.includes("texture") || hasCorpusMatch(analysis, /\btexture(?:d|ing)?\b|\btexture match\b/i);
  const blendRepairScope = hasCorpusMatch(analysis, /\bblend(?:ed|ing)?\b/i);
  const includeLocationSuffix = location && !new RegExp(`\\b${location.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(target);
  const locationSuffix = includeLocationSuffix ? buildLocationSuffix(location) : "";
  let directLine = ensureSentence(`${repairVerb} ${target}${locationSuffix}`);
  let processLine = ensureSentence("Prepare affected areas as needed for the described repair, complete patching or repair work, and clean up the work area");
  let environmentLine = buildScopedEnvironmentLine(analysis, "stated repair scope");
  let exclusion = explicitExclusion || fallbackExclusion || "concealed damage, substrate failure, and work beyond the direct repair area are not included unless identified and approved";
  let directWorkHints = [`${actions.includes("patch") ? "patch" : "repair"} affected areas as required`];
  let completionHints = ["clean up the work area"];
  const waterDamageContext = hasCorpusMatch(analysis, WATER_DAMAGE_CONTEXT_REGEX);
  const explicitWaterLeakContext = /\bwater got in\b|\bwater came in\b|\bwater damage\b|\bvisible leak damage\b|\bleak(?:ed|ing)?(?:\s+damage)?\b|\bleak area\b|\bstained ceiling\b|\bwet\b|\bmoisture\b/i.test(
    uniqueList([analysis?.rawScopeText, analysis?.coreScopeText, target]).join(" ")
  );
  const perimeterComponentTarget = isLowLevelPerimeterComponentTarget(target) || perimeterScopeHints.includes("perimeter_seal_scope");
  const supportComponentTarget = isLowLevelSupportComponentTarget(target);
  const builtInScope = scopeAssetCategory === "interior_builtin" || objectType === "built_in_assembly";
  const openingAssemblyScope = ["framed_opening_object", "opening_assembly", "panel_closure_object"].includes(objectType);

  if ((waterDamageContext || explicitWaterLeakContext || waterDamageRepairHints.length) && /\bwall\b/i.test(`${target} ${analysis?.coreScopeText || ""}`)) {
    directLine = ensureSentence(`${repairVerb} affected wall areas where water intrusion is evident${locationSuffix}`);
    processLine = ensureSentence(`Prepare the affected wall area as needed, complete localized patching or repair within the stated scope${finishFollowupScope ? ", blend or restore adjacent finishes as required directly within the stated area," : ","} and clean up the work area`);
    exclusion = explicitExclusion || fallbackExclusion || "concealed moisture damage, substrate failure, and finish work beyond the direct repair area are not included unless identified and approved";
    directWorkHints = ["repair affected wall areas where water intrusion is evident"];
  } else if ((waterDamageContext || explicitWaterLeakContext || waterDamageRepairHints.length) && /\bceiling\b/i.test(`${target} ${analysis?.coreScopeText || ""}`)) {
    directLine = ensureSentence(`${repairVerb} affected ceiling areas where leak or moisture damage is visible${locationSuffix}`);
    processLine = ensureSentence(`Prepare the affected ceiling area as needed, complete localized patching or repair within the stated scope${finishFollowupScope ? ", blend adjacent finish work as applicable," : ", blend adjacent finishes as applicable,"} and clean up the work area`);
    exclusion = explicitExclusion || fallbackExclusion || "concealed moisture damage, substrate failure, and repair beyond the visible leak-damaged area are not included unless identified and approved";
    directWorkHints = ["repair affected ceiling areas where leak or moisture damage is visible"];
  } else if (/\bstucco\b/i.test(target)) {
    directLine = ensureSentence(`${repairVerb} ${target}${locationSuffix} and address loose or cracked finish material within the stated repair area`);
    processLine = ensureSentence("Prepare the affected exterior surface as needed, complete patching and texture blending as closely as practical, and clean up the work area");
    environmentLine = buildScopedEnvironmentLine(analysis, "stated stucco repair scope");
    exclusion = explicitExclusion || fallbackExclusion || "full elevation coating, concealed moisture damage, and structural crack remediation are not included unless identified and approved";
    directWorkHints = ["address loose or cracked stucco within the stated repair area"];
    completionHints = ["complete texture blending as closely as practical", "clean up the work area"];
  } else if (/\bcurbs?\b/i.test(target)) {
    directLine = ensureSentence(`${repairVerb} ${target}${locationSuffix} and restore the affected curb profile within the stated repair area`);
    processLine = ensureSentence("Remove loose material as needed, complete patching or repair to the described curb section, and clean up the work area");
    environmentLine = buildScopedEnvironmentLine(analysis, "stated curb repair scope");
    exclusion = explicitExclusion || fallbackExclusion || "full curb replacement, subgrade correction, and traffic control are not included unless identified and approved";
    directWorkHints = ["restore the affected curb profile within the stated repair area"];
  } else if (/\bstorefront frame\b/i.test(target)) {
    directLine = ensureSentence(`${repairVerb} ${target}${locationSuffix} and address accessible frame components within the stated repair scope`);
    processLine = ensureSentence("Complete required adjustments, fastening, sealant touch-up, and cleanup for the described repair area");
    environmentLine = buildScopedEnvironmentLine(analysis, "stated storefront frame repair scope");
    exclusion = explicitExclusion || fallbackExclusion || "glass replacement, hardware replacement, and concealed structural movement are not included unless identified and approved";
    directWorkHints = ["address accessible storefront frame components within the stated repair scope"];
  } else if (waterDamageRepairHints.includes("adjacent_window_repair")) {
    directLine = ensureSentence(`${repairVerb} leak-damaged areas around window${locationSuffix && !/\bwindow\b/i.test(location) ? locationSuffix : ""}`);
    processLine = ensureSentence("Prepare adjacent perimeter surfaces as needed, complete localized patching or repair within the stated scope, blend transitions as applicable, and clean up the work area");
    exclusion = explicitExclusion || fallbackExclusion || "concealed moisture damage, substrate failure, and repairs beyond the direct perimeter area are not included unless identified and approved";
    directWorkHints = ["complete localized repair of visible leak-damaged areas around the affected window perimeter"];
  } else if (perimeterScopeHints.includes("adjacent_finish_repair")) {
    directLine = ensureSentence(`${repairVerb} around ${target}${locationSuffix}`);
    processLine = ensureSentence(`Prepare adjacent perimeter surfaces as needed, complete localized patching or repair within the stated scope${finishFollowupScope || adjacentMakeGoodScope ? ", blend or make good directly affected finishes as applicable," : ", blend transitions as applicable,"} and clean up the work area`);
    exclusion = explicitExclusion || fallbackExclusion || "concealed damage, substrate failure, and repairs beyond the direct perimeter area are not included unless identified and approved";
    directWorkHints = ["complete localized patching or repair within the stated perimeter area"];
  } else if (
    /\bwall\b|\bceiling\b/i.test(`${target} ${analysis?.coreScopeText || ""}`)
    && !builtInScope
    && !openingAssemblyScope
    && !hasSiteExteriorScopeSignals(analysis)
  ) {
    directLine = ensureSentence(`${repairVerb} ${target}${locationSuffix}`);
    processLine = ensureSentence(`Prepare affected areas as needed for the described repair${finishFollowupScope || adjacentMakeGoodScope ? ", blend or make good directly affected finishes as applicable," : ", complete patching or repair work,"} and clean up the work area`);
    exclusion = explicitExclusion || fallbackExclusion || "concealed damage, substrate failure, and work beyond the direct repair area are not included unless identified and approved";
    directWorkHints = [`${actions.includes("patch") ? "patch" : "repair"} the affected wall or ceiling area within the stated scope`];
  } else if (builtInScope) {
    directLine = ensureSentence(`${repairVerb} ${target}${locationSuffix}`);
    processLine = ensureSentence(
      `Adjust, resecure, and repair accessible cabinet, shelving, casework, millwork, or built-in components within the stated scope${adjacentMakeGoodScope ? ", complete minor adjacent wall or finish make-good where directly affected" : ""}, verify fit and operation where applicable, and clean up the work area`
    );
    exclusion = explicitExclusion || fallbackExclusion || "countertops, plumbing or electrical hookups, wall repair beyond direct attachment areas, and work outside the stated casework scope are not included unless identified and approved";
    directWorkHints = ["repair accessible cabinet, shelving, casework, millwork, or built-in components within the stated scope"];
  } else if (closeUpOpeningScope) {
    directLine = ensureSentence(`Close up ${/\bopening\b/i.test(target) ? target : "opening"}${locationSuffix}`);
    processLine = ensureSentence(
      openingClosureHints.includes("framed_closure_support")
        ? "Frame or back the opening as required within the stated scope, patch and close the opening, blend adjacent finishes as needed, and clean up the work area"
        : "Patch and close the opening within the stated scope, blend adjacent finishes as needed, and clean up the work area"
    );
    exclusion = explicitExclusion || fallbackExclusion || "framing correction beyond the direct closure scope, concealed damage, and finish repairs outside the stated area are not included unless identified and approved";
    directWorkHints = ["patch and close the opening within the stated scope"];
  } else if (openingAssemblyScope && scopeAssetCategory !== "door_hardware") {
    directLine = ensureSentence(`${repairVerb} ${target}${locationSuffix}`);
    processLine = ensureSentence(
      capitalizePhrase(
        joinPlainPhrases(
          mergeWorkflowClauses(
            [
              "address accessible frame, attachment, closure, and alignment items within the stated assembly scope",
              perimeterFollowupScope
                ? "complete localized perimeter seal, trim, flashing, or finish tie-in where directly affected"
                : "complete localized sealant, trim, or finish tie-in where directly affected as applicable",
              securementFollowupScope
                ? "complete localized securement or attachment correction as required"
                : "verify fit and operation where applicable",
              "clean up the work area",
            ],
            connectionMethodHints
          )
        )
      )
    );
    exclusion = explicitExclusion || fallbackExclusion || "framing correction, concealed damage, and repairs beyond the direct opening or closure scope are not included unless identified and approved";
    directWorkHints = ["address accessible frame, attachment, closure, and alignment items within the stated assembly scope"];
  } else if (objectType === "hardware_component" && scopeAssetCategory !== "site_hardware") {
    directLine = ensureSentence(`${repairVerb} ${target}${locationSuffix}`);
    if (perimeterComponentTarget) {
      processLine = ensureSentence(
        capitalizePhrase(
          joinPlainPhrases(
            mergeWorkflowClauses(
              ["address localized perimeter seal, threshold, sweep, or weatherstrip attachment within the stated repair scope", "complete minor fit, closure, or seal continuity adjustment as required", "clean up the work area"],
              connectionMethodHints
            )
          )
        )
      );
      exclusion = explicitExclusion || fallbackExclusion || "frame correction, concealed damage, and perimeter replacement beyond the direct seal or component scope are not included unless identified and approved";
      directWorkHints = ["address localized perimeter seal, threshold, sweep, or weatherstrip attachment within the stated repair scope"];
    } else if (supportComponentTarget) {
      processLine = ensureSentence(
        capitalizePhrase(
          joinPlainPhrases(
            mergeWorkflowClauses(
              ["address localized bracket, cover, cap, or support attachment and securement within the stated repair scope", "complete minor adjustment or resecure work as required", "clean up the work area"],
              connectionMethodHints
            )
          )
        )
      );
      exclusion = explicitExclusion || fallbackExclusion || "concealed damage, attachment backing correction, and full assembly replacement beyond the direct component scope are not included unless identified and approved";
      directWorkHints = ["address localized bracket, cover, cap, or support attachment and securement within the stated repair scope"];
    } else {
      processLine = ensureSentence(
        capitalizePhrase(
          joinPlainPhrases(
            mergeWorkflowClauses(
              ["address localized hardware attachment, alignment, and securement within the stated repair scope", "complete minor component adjustment or resecure work as required", "clean up the work area"],
              connectionMethodHints
            )
          )
        )
      );
      exclusion = explicitExclusion || fallbackExclusion || "frame correction, concealed damage, and full assembly replacement beyond the direct component scope are not included unless identified and approved";
      directWorkHints = ["address localized hardware attachment, alignment, and securement within the stated repair scope"];
    }
  } else if (
    ["site_hardware"].includes(scopeAssetCategory)
    || ["anchored_object", "mounted_object", "site_exterior_asset", "hardware_component"].includes(objectType)
  ) {
    directLine = ensureSentence(`${repairVerb} ${target}${locationSuffix}`);
    processLine = ensureSentence(
      capitalizePhrase(
        joinPlainPhrases(
          mergeWorkflowClauses(
            ["address accessible attachments, anchorage, and alignment within the stated repair scope", "complete localized securement or component repair as required", "clean up the work area"],
            connectionMethodHints
          )
        )
      )
    );
    exclusion = explicitExclusion || fallbackExclusion || "structural post replacement, base or foundation work, and concealed damage beyond the direct repair scope are not included unless identified and approved";
    directWorkHints = ["address accessible attachments, anchorage, and alignment within the stated repair scope"];
  }

  if (textureFinishScope && !/\btexture\b/i.test(processLine)) {
    processLine = ensureSentence(
      `${stripSentencePunctuation(processLine)}, including texture blending as required within the stated repair area`
    );
  } else if (blendRepairScope && !/\bblend\b/i.test(processLine)) {
    processLine = ensureSentence(
      `${stripSentencePunctuation(processLine)}, blending the repaired finish as closely as practical within the stated repair area`
    );
  }

  if (partialScopeHints.length && !/\bstated repair area\b/i.test(processLine)) {
    processLine = ensureSentence(
      `${stripSentencePunctuation(processLine)}, keeping the work limited to the affected section, side, corner, edge, or stated area`
    );
  }

  return {
    directWorkHints,
    completionHints,
    exclusion,
    lines: uniqueList([directLine, processLine, environmentLine, renderExclusionSentence(exclusion)]).filter(Boolean),
  };
}

function buildRepairPatchScopeLines(analysis) {
  return resolveRepairScopePlan(analysis).lines;
}

function resolveReplaceableAssetCategoryRegex(category = "") {
  if (category === "interior_builtin") return INTERIOR_BUILTIN_ASSET_REGEX;
  if (category === "plumbing_fixture") return PLUMBING_FIXTURE_ASSET_REGEX;
  if (category === "plumbing_equipment") return PLUMBING_EQUIPMENT_ASSET_REGEX;
  if (category === "mechanical_equipment") return MECHANICAL_EQUIPMENT_ASSET_REGEX;
  if (category === "electrical_equipment") return ELECTRICAL_EQUIPMENT_ASSET_REGEX;
  if (category === "glazing_storefront") return GLAZING_STOREFRONT_ASSET_REGEX;
  if (category === "door_hardware") return DOOR_HARDWARE_ASSET_REGEX;
  if (category === "site_hardware") return SITE_HARDWARE_ASSET_REGEX;
  if (category === "general_equipment") return GENERAL_EQUIPMENT_ASSET_REGEX;
  return null;
}

function resolveReplaceableAssetTargetPhrase(analysis, category = "") {
  const matcher = resolveReplaceableAssetCategoryRegex(category);
  const preferredObjectPhrase = resolvePreferredObjectPhrase({
    ...analysis,
    scopeAssetCategory: category || analysis?.scopeAssetCategory,
  });
  const explicitCandidates = uniqueList([
    ...(Array.isArray(analysis?.quantityItemPairs) ? analysis.quantityItemPairs : []),
    ...(Array.isArray(analysis?.items) ? analysis.items : []),
    ...(Array.isArray(analysis?.actionItemPhrases) ? analysis.actionItemPhrases : []),
  ]).filter(Boolean);
  const candidates = uniqueList([
    ...explicitCandidates,
    preferredObjectPhrase,
    ...(Array.isArray(analysis?.locations) ? analysis.locations : []),
    firstSkeletonValue(analysis, "directWork", "certain"),
    analysis?.coreScopeText,
    resolvePrimaryScopePhrase(analysis),
  ]).filter(Boolean);

  const explicitMatch = explicitCandidates.find((value) => matcher && matcher.test(value)) || "";
  const lowLevelPriority = (
    (category || analysis?.scopeAssetCategory) === "door_hardware"
    || analysis?.objectType === "hardware_component"
    || isLowLevelPerimeterComponentTarget(preferredObjectPhrase || explicitMatch)
    || isLowLevelSupportComponentTarget(preferredObjectPhrase || explicitMatch)
    || LOW_LEVEL_TRIM_COMPONENT_REGEX.test(preferredObjectPhrase || explicitMatch)
  );
  const primary = (lowLevelPriority ? preferredObjectPhrase || explicitMatch : explicitMatch || preferredObjectPhrase)
    || candidates.find((value) => matcher && matcher.test(value))
    || pickPreferredTargetCandidate(candidates)
    || "equipment";
  return normalizeTargetPhrase(primary) || "equipment";
}

function resolveReplaceableAssetScopePlan(analysis, category = "") {
  const actions = Array.isArray(analysis?.actions) ? analysis.actions : [];
  const location = Array.isArray(analysis?.locations) ? analysis.locations[0] : "";
  const partialScopeHints = Array.isArray(analysis?.partialScopeHints) ? analysis.partialScopeHints : [];
  const perimeterScopeHints = Array.isArray(analysis?.perimeterScopeHints) ? analysis.perimeterScopeHints : [];
  const resetIntent = String(analysis?.resetIntent || "").trim();
  const explicitExclusion = firstSkeletonValue(analysis, "exclusions", "certain");
  const fallbackExclusion = firstSkeletonValue(analysis, "exclusions", "riskyMissing");
  const accessPhrase = resolveAccessCoordinationPhrase(analysis);
  const resetScope = Boolean(resetIntent);
  const replacementScope = !resetScope && (
    hasActionFamily(analysis, "replace_changeout")
    || ((actions.includes("remove") || actions.includes("demo")) && actions.includes("install"))
  );
  const removalOnlyScope = hasActionFamily(analysis, "remove_demo") && !replacementScope;
  const installationOnlyScope = hasActionFamily(analysis, "install_add_mount") && !replacementScope && !removalOnlyScope && !resetScope;
  const rawTarget = resolveReplaceableAssetTargetPhrase(analysis, category);
  const target = (replacementScope || removalOnlyScope) && !/\bexisting\b/i.test(rawTarget) && !/\bnew\b/i.test(rawTarget)
    ? `existing ${rawTarget}`
    : rawTarget;
  const includeLocationSuffix = location && !new RegExp(`\\b${location.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(target);
  const directLocationSuffix = includeLocationSuffix ? buildLocationSuffix(location) : "";
  const holeCreationIntent = normalizeScopePhrase(analysis?.holeCreationIntent || "");
  const connectionMethodHints = Array.isArray(analysis?.connectionMethodHints) ? analysis.connectionMethodHints : [];
  const siteAssemblyHints = Array.isArray(analysis?.siteAssemblyHints) ? analysis.siteAssemblyHints : [];
  const adjacentMakeGoodScope = hasMidLevelAdjacentMakeGoodScope(analysis);
  const perimeterFollowupScope = hasMidLevelPerimeterFollowupScope(analysis);
  const securementFollowupScope = hasMidLevelSecurementFollowupScope(analysis);

  let categoryConfig = {
    interior_builtin: {
      installLead: "Install",
      replacementHint: "lay out the replacement units, place, level, align, and secure cabinet, casework, shelving, or built-in components within the stated scope",
      removalHint: "remove accessible fasteners, trim, or attachment points required for safe removal",
      installHint: "lay out, place, level, align, and secure the described cabinet, casework, shelving, or built-in components within the stated scope",
      replacementCompletion: "verify fit and operation where applicable and clean up the work area",
      removalCompletion: "remove debris and clean up the work area",
      installCompletion: "verify fit and operation where applicable and clean up the work area",
      exclusion: "countertops, plumbing or electrical hookups, wall repair beyond direct attachment areas, and work outside the stated casework scope are not included unless identified and approved",
    },
    plumbing_fixture: {
      installLead: "Install",
      replacementHint: "disconnect and reconnect accessible water, waste, trim, or supply connections as applicable",
      removalHint: "disconnect accessible water, waste, trim, or supply connections required for safe removal as applicable",
      installHint: "complete accessible mounting and utility connections as applicable",
      replacementCompletion: "verify operation, remove and dispose of replaced fixture materials, and clean up the work area",
      removalCompletion: "remove and dispose of removed fixture materials and clean up the work area",
      installCompletion: "verify operation and clean up the work area",
      exclusion: "water line, waste line, valve, trim, and code-related corrections beyond direct replacement are not included unless identified and approved",
    },
    plumbing_equipment: {
      installLead: "Furnish and install",
      replacementHint: "disconnect and reconnect accessible water, vent, relief, gas, or electrical connections as applicable",
      removalHint: "disconnect accessible water, vent, relief, gas, or electrical connections required for safe removal as applicable",
      installHint: "complete accessible water, vent, relief, gas, or electrical connections as applicable",
      replacementCompletion: "set the replacement unit, verify operation, remove and dispose of replaced equipment, and clean up the work area",
      removalCompletion: "remove and dispose of removed equipment and clean up the work area",
      installCompletion: "set and secure the unit, verify operation, and clean up the work area",
      exclusion: "venting rework, gas piping, water piping changes, electrical circuit changes, and code-required upgrades beyond direct replacement are not included unless identified and approved",
    },
    mechanical_equipment: {
      installLead: "Furnish and install",
      replacementHint: "disconnect and reconnect accessible power, duct, drain, vent, refrigerant, or control connections as applicable",
      removalHint: "disconnect accessible power, duct, drain, vent, refrigerant, or control connections required for safe removal as applicable",
      installHint: "complete accessible power, duct, drain, vent, refrigerant, or control connections as applicable",
      replacementCompletion: "set and secure the replacement unit, verify operation, remove and dispose of replaced equipment, and clean up the work area",
      removalCompletion: "remove and dispose of removed equipment and clean up the work area",
      installCompletion: "set and secure the unit, verify operation, and clean up the work area",
      exclusion: "roof, wall, ceiling, curb, balancing, controls integration, and utility modifications beyond direct replacement are not included unless identified and approved",
    },
    electrical_equipment: {
      installLead: "Install",
      replacementHint: "disconnect and reconnect accessible conductors, terminations, mounting, or attachments required for the replacement as applicable",
      removalHint: "disconnect accessible conductors, terminations, mounting, or attachments required for safe removal as applicable",
      installHint: "complete accessible mounting, terminations, and service connections as applicable",
      replacementCompletion: "verify operation, remove and dispose of replaced equipment, and clean up the work area",
      removalCompletion: "remove and dispose of removed equipment and clean up the work area",
      installCompletion: "verify operation and clean up the work area",
      exclusion: "feeder changes, circuit extensions, and code-driven upgrades beyond direct replacement are not included unless identified and approved",
    },
    door_hardware: {
      installLead: "Install",
      replacementHint: "complete required mounting, fastening, and hardware adjustments for the replacement",
      removalHint: "remove existing hardware and disconnect related attachments required for safe removal",
      installHint: "complete required mounting, fastening, and hardware adjustments for the described installation",
      replacementCompletion: "adjust for fit and proper operation and clean up the work area",
      removalCompletion: "remove debris and clean up the work area",
      installCompletion: "adjust for fit and proper operation and clean up the work area",
      exclusion: "door, frame, storefront, or glazing repair and hardware modifications beyond direct replacement are not included unless identified and approved",
    },
    glazing_storefront: {
      installLead: "Install",
      replacementHint: "complete accessible setting, sealant, and attachment work required for the replacement",
      removalHint: "remove accessible sealant, trim, and attachments required for safe removal",
      installHint: "complete accessible setting, sealant, and attachment work required for the described installation",
      replacementCompletion: "adjust for fit where required, clean up the work area, and leave the opening secure within the stated scope",
      removalCompletion: "remove debris, protect the surrounding opening as needed within the stated scope, and clean up the work area",
      installCompletion: "adjust for fit where required and clean up the work area",
      exclusion: "frame repair, waterproofing investigation, structural corrections, and work beyond the stated glazing scope are not included unless identified and approved",
    },
    site_hardware: {
      installLead: "Install",
      replacementHint: "complete accessible attachments, anchorage, and related hardware required for the replacement as applicable",
      removalHint: "remove accessible attachments, anchorage, or related hardware required for safe removal as applicable",
      installHint: "complete accessible attachments, anchorage, and related hardware required for the described installation as applicable",
      replacementCompletion: "set and secure the replacement assembly, verify operation where applicable, and clean up the work area",
      removalCompletion: "remove and dispose of removed materials and clean up the work area",
      installCompletion: "set and secure the assembly, verify operation where applicable, and clean up the work area",
      exclusion: "base or foundation work, underground utility work, and site restoration beyond direct replacement are not included unless identified and approved",
    },
    general_equipment: {
      installLead: "Furnish and install",
      replacementHint: "disconnect and reconnect accessible utilities, controls, or attachments required for the replacement as applicable",
      removalHint: "disconnect accessible utilities, controls, or attachments required for safe removal as applicable",
      installHint: "complete accessible mounting, securement, and utility connections required for the described installation as applicable",
      replacementCompletion: "set and secure the replacement unit, verify operation where applicable, remove and dispose of replaced equipment, and clean up the work area",
      removalCompletion: "remove and dispose of removed equipment and clean up the work area",
      installCompletion: "set and secure the unit, verify operation where applicable, and clean up the work area",
      exclusion: "structural modifications, utility changes, and code-driven upgrades beyond direct replacement are not included unless identified and approved",
    },
  }[category] || {
    installLead: "Install",
    replacementHint: "disconnect and reconnect accessible services or attachments required for the replacement as applicable",
    removalHint: "disconnect accessible services or attachments required for safe removal as applicable",
    installHint: "complete accessible mounting and service connections as applicable",
    replacementCompletion: "set and secure the replacement item, verify operation where applicable, remove and dispose of replaced materials, and clean up the work area",
    removalCompletion: "remove and dispose of removed materials and clean up the work area",
    installCompletion: "set and secure the item, verify operation where applicable, and clean up the work area",
    exclusion: "related utility changes, structural modifications, and work beyond the direct replacement scope are not included unless identified and approved",
  };

  if (category === "door_hardware" && isLowLevelPerimeterComponentTarget(rawTarget)) {
    categoryConfig = {
      ...categoryConfig,
      replacementHint: "remove failed perimeter components as needed, install replacement seal, sweep, threshold, or weatherstrip materials within the stated scope, and complete required fit and closure adjustment",
      removalHint: "remove failed perimeter components required for safe removal within the stated scope",
      installHint: "install the described perimeter seal, sweep, threshold, or weatherstrip components and complete required fit and closure adjustment within the stated scope",
      replacementCompletion: "adjust for fit, closure, and proper operation where applicable and clean up the work area",
      installCompletion: "adjust for fit, closure, and proper operation where applicable and clean up the work area",
      exclusion: "door, frame, substrate, and perimeter correction beyond the direct component replacement scope are not included unless identified and approved",
    };
  }

  if (category === "interior_builtin" && adjacentMakeGoodScope) {
    categoryConfig = {
      ...categoryConfig,
      replacementHint: `${categoryConfig.replacementHint}, complete minor adjacent wall or finish make-good where directly affected`,
      installHint: `${categoryConfig.installHint}, complete minor adjacent wall or finish make-good where directly affected`,
    };
  }

  if (category === "glazing_storefront" && perimeterFollowupScope) {
    categoryConfig = {
      ...categoryConfig,
      replacementHint: "complete accessible setting, sealant, perimeter attachment, and closure work required for the replacement",
      installHint: "complete accessible setting, sealant, perimeter attachment, and closure work required for the described installation",
    };
  }

  if (category === "site_hardware" && securementFollowupScope) {
    categoryConfig = {
      ...categoryConfig,
      replacementHint: `${categoryConfig.replacementHint}, complete localized securement, alignment, or connection work where directly affected`,
      installHint: `${categoryConfig.installHint}, complete localized securement, alignment, or connection work where directly affected`,
    };
  }

  let directLine = replacementScope
    ? ensureSentence(`Remove and replace ${target}${directLocationSuffix}`)
    : removalOnlyScope
      ? ensureSentence(`Remove ${target}${directLocationSuffix}`)
      : ensureSentence(`${categoryConfig.installLead} ${rawTarget}${includeLocationSuffix ? buildLocationSuffix(location) : ""}`);
  if (resetScope) {
    directLine = ensureSentence(
      `${resetIntent === "temporary_remove_reinstall" ? "Temporarily remove and reinstall" : "Remove and reinstall"} ${target}${directLocationSuffix}`
    );
  }
  const processClauses = mergeWorkflowClauses(
    holeCreationIntent ? [holeCreationIntent] : [],
    [
      resetScope
        ? (
      resetIntent === "temporary_remove_reinstall"
            ? `detach the existing item as required for access or adjacent repair, protect reusable components within the stated scope, reinstall and secure the item after repair is complete, verify fit and attachment${adjacentMakeGoodScope ? ", complete minor adjacent wall or finish make-good where directly affected" : ""}, and clean up the work area`
            : `remove the existing item as needed, protect and store reusable components within the stated scope, reinstall and secure the item, verify fit and attachment${adjacentMakeGoodScope ? ", complete minor adjacent wall or finish make-good where directly affected" : ""}, and clean up the work area`
        )
        : replacementScope
        ? `${categoryConfig.replacementHint}, ${categoryConfig.replacementCompletion}`
        : removalOnlyScope
          ? `${categoryConfig.removalHint}, ${categoryConfig.removalCompletion}`
          : `${categoryConfig.installHint}, ${categoryConfig.installCompletion}`,
      ...connectionMethodHints,
    ]
  );
  if (partialScopeHints.length || perimeterScopeHints.length) {
    processClauses.push("keep the work limited to the affected section, perimeter, or stated work area");
  }
  let processLine = ensureSentence(capitalizePhrase(joinPlainPhrases(processClauses)));
  if (accessPhrase) {
    processLine = ensureSentence(`${accessPhrase}, ${decapitalizePhrase(stripSentencePunctuation(processLine))}`);
  }
  const environmentLine = (
    category === "site_hardware"
    || analysis?.siteExteriorContext
    || category === "glazing_storefront"
    || resolvePrimaryCommercialContext(analysis)
  )
    ? buildScopedEnvironmentLine(
      analysis,
      category === "glazing_storefront"
        ? "stated glazing scope"
        : (category === "site_hardware" || analysis?.siteExteriorContext ? "stated asset scope" : "stated replacement scope")
    )
    : "";
  let qualifierLine = renderExclusionSentence(explicitExclusion || fallbackExclusion || categoryConfig.exclusion);

  if (category === "site_hardware" && siteAssemblyHints.includes("fence_perimeter_assembly")) {
    const fenceTarget = replacementScope || removalOnlyScope ? target : rawTarget;
    const fenceDirectLine = replacementScope
      ? ensureSentence(`Remove and replace ${fenceTarget}${directLocationSuffix}`)
      : removalOnlyScope
        ? ensureSentence(`Remove ${fenceTarget}${directLocationSuffix}`)
        : ensureSentence(`Install ${rawTarget}${includeLocationSuffix ? buildLocationSuffix(location) : ""}`);
    const fenceClauses = mergeWorkflowClauses(
      [
        "lay out the fence line and locate post positions",
        holeCreationIntent || "create required post or anchor holes within the stated scope",
      ],
      replacementScope
        ? [
          "set and align posts or supports as required",
          "install fence sections within the stated fence line",
          ...connectionMethodHints,
          "verify attachment, alignment, and continuity of the fence assembly within accessible work areas",
          "remove and dispose of incidental installation debris and clean up the work area",
        ]
        : removalOnlyScope
          ? [
            "remove accessible attachments or fence components required for safe removal",
            "remove and dispose of removed materials and incidental debris and clean up the work area",
          ]
          : [
            "set and align posts or supports as required",
            "install fence sections within the stated fence line",
            ...connectionMethodHints,
            "verify attachment, alignment, and continuity of the fence assembly within accessible work areas",
            "remove and dispose of incidental installation debris and clean up the work area",
          ]
    );
    processLine = ensureSentence(capitalizePhrase(joinPlainPhrases(fenceClauses)));
    if (accessPhrase) {
      processLine = ensureSentence(`${accessPhrase}, ${decapitalizePhrase(stripSentencePunctuation(processLine))}`);
    }
    qualifierLine = renderExclusionSentence(
      explicitExclusion
        || fallbackExclusion
        || "concealed obstructions, utility conflicts, major grade correction, and work beyond the stated fence limits are not included unless identified and approved"
    );
    return {
      directWorkHints: ["lay out the fence line and install the described fence assembly"],
      completionHints: ["verify attachment, alignment, and continuity of the fence assembly", "clean up the work area"],
      exclusion: explicitExclusion || fallbackExclusion || "concealed obstructions, utility conflicts, major grade correction, and work beyond the stated fence limits are not included unless identified and approved",
      lines: uniqueList([fenceDirectLine, processLine, environmentLine, qualifierLine]).filter(Boolean),
    };
  }

  return {
    directWorkHints: [replacementScope ? categoryConfig.replacementHint : removalOnlyScope ? categoryConfig.removalHint : categoryConfig.installHint],
    completionHints: [replacementScope ? categoryConfig.replacementCompletion : removalOnlyScope ? categoryConfig.removalCompletion : categoryConfig.installCompletion],
    exclusion: explicitExclusion || fallbackExclusion || categoryConfig.exclusion,
    lines: uniqueList([directLine, processLine, environmentLine, qualifierLine]).filter(Boolean),
  };
}

function buildReplaceableAssetScopeLines(analysis) {
  const category = analysis?.replaceableAssetCategory || resolveReplaceableAssetCategory(analysis);
  if (!category) return [];
  return resolveReplaceableAssetScopePlan(analysis, category).lines;
}

function buildSiteEquipmentTechnicalScopeLines(analysis, flags = {}) {
  const rawWorkPhrase = normalizeScopePhrase(
    firstSkeletonValue(analysis, "directWork", "certain")
    || analysis?.coreScopeText
    || resolvePrimaryScopePhrase(analysis)
  );
  const technicalItem = normalizeScopePhrase(
    (Array.isArray(analysis?.items) ? analysis.items : []).find((item) => SITE_EQUIPMENT_OBJECT_REGEX.test(item))
    || rawWorkPhrase
    || resolvePrimaryScopePhrase(analysis)
  )
    .replace(/^(?:install|replace|remove|demo)\s+/i, "")
    .trim() || "site equipment";
  const actions = Array.isArray(analysis?.actions) ? analysis.actions : [];
  const location = Array.isArray(analysis?.locations) ? analysis.locations[0] : "";
  const explicitExclusion = firstSkeletonValue(analysis, "exclusions", "certain");
  const fallbackExclusion = firstSkeletonValue(analysis, "exclusions", "riskyMissing");
  const replacementScope = actions.includes("replace");
  const removalOnlyScope = (actions.includes("remove") || actions.includes("demo")) && !replacementScope;
  const installationOnlyScope = actions.includes("install") && !replacementScope;
  const scopedTechnicalItem = (replacementScope || removalOnlyScope) && !/\bexisting\b|\bnew\b/i.test(technicalItem)
    ? `existing ${technicalItem}`
    : technicalItem;
  const servicePhrase = flags.siteLightingScope
    ? (replacementScope ? "disconnecting and reconnecting accessible site-lighting conductors or attachments" : "disconnecting accessible site-lighting conductors or attachments")
    : (replacementScope ? "disconnecting and reconnecting accessible services or attachments" : "disconnecting accessible services or attachments");
  const accessPhrase = flags.poleMountedSiteAssetScope
    ? "Coordinate lift or suitable access equipment as required"
    : "Coordinate access equipment or safe handling as required";
  const includeLocationSuffix = location && !new RegExp(`\\b${location.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(technicalItem);

  let directLine = ensureSentence(
    `Remove ${scopedTechnicalItem}${includeLocationSuffix ? buildLocationSuffix(location) : ""} including ${servicePhrase} required for safe removal and removing the assembly`
  );
  let processLine = ensureSentence(`${accessPhrase} for safe removal, remove debris and dispose of removed materials, and clean up the work area`);
  let environmentLine = flags.hospitalityContext
    ? ensureSentence("Keep the work within the identified hotel site area and the stated asset scope")
    : flags.commercialSiteContext
      ? ensureSentence("Keep the work within the identified commercial/site area and the stated asset scope")
      : "";
  let qualifierLine = renderExclusionSentence(
    explicitExclusion || fallbackExclusion || "base or foundation removal, underground wiring repairs, utility/service changes, and work beyond accessible disconnect points are not included unless identified and approved"
  );

  if (replacementScope) {
    directLine = ensureSentence(
      `Remove and replace ${scopedTechnicalItem}${includeLocationSuffix ? buildLocationSuffix(location) : ""} including ${servicePhrase} required for the replacement`
    );
    processLine = ensureSentence(`${accessPhrase}, set and secure the replacement assembly, verify operation where applicable, and clean up the work area`);
    qualifierLine = renderExclusionSentence(
      explicitExclusion || fallbackExclusion || "base or foundation repair, underground wiring repairs, utility/service changes, and work beyond accessible site connections are not included unless identified and approved"
    );
  } else if (installationOnlyScope) {
    directLine = ensureSentence(
      `Install ${technicalItem}${includeLocationSuffix ? buildLocationSuffix(location) : ""} and complete accessible mounting, securement, and service connections required for the described scope`
    );
    processLine = ensureSentence(`${accessPhrase}, set and secure the described assembly, verify operation where applicable, and clean up the work area`);
    qualifierLine = renderExclusionSentence(
      explicitExclusion || fallbackExclusion || "base or foundation repair, underground wiring repairs, utility/service changes, and work beyond accessible site connections are not included unless identified and approved"
    );
  }

  return uniqueList([directLine, processLine, environmentLine, qualifierLine]).filter(Boolean);
}

function buildElectricalCommercialTechnicalScopeLines(analysis, flags = {}) {
  const coreScopeText = normalizeScopePhrase(analysis?.coreScopeText || "");
  const rawWorkPhrase = normalizeScopePhrase(
    firstSkeletonValue(analysis, "directWork", "certain")
    || analysis?.coreScopeText
    || resolvePrimaryScopePhrase(analysis)
  );
  const technicalItem = normalizeScopePhrase(
    (Array.isArray(analysis?.items) ? analysis.items : []).find((item) => /\bbreakers?\b|\bdisconnect\b|\bconduit\b|\braceway\b|\bpackage unit\b|\brtu\b/i.test(item))
    || rawWorkPhrase
    || resolvePrimaryScopePhrase(analysis)
  )
    .replace(/^(?:install|replace|run)\s+/i, "")
    .trim();
  const location = Array.isArray(analysis?.locations) ? analysis.locations[0] : "";
  const explicitExclusion = firstSkeletonValue(analysis, "exclusions", "certain");
  const fallbackExclusion = firstSkeletonValue(analysis, "exclusions", "riskyMissing");
  const actions = Array.isArray(analysis?.actions) ? analysis.actions : [];
  const replacementScope = actions.includes("replace");
  const installationOnlyScope = actions.includes("install") && !replacementScope;
  const directLead = actions.includes("replace")
    ? "Replace"
    : flags.conduitScope
      ? "Install"
      : actions.includes("install")
        ? "Install"
        : "Complete";
  const directObjectSource = (
    (flags.disconnectScope && /\bdisconnect\b/i.test(rawWorkPhrase) && rawWorkPhrase)
    || (flags.breakerScope && /\bbreakers?\b/i.test(rawWorkPhrase) && rawWorkPhrase)
    || (flags.conduitScope && /\bconduit\b/i.test(rawWorkPhrase) && rawWorkPhrase)
    || technicalItem
    || rawWorkPhrase
    || coreScopeText
    || "the stated electrical scope"
  );
  let directObject = normalizeScopePhrase(directObjectSource).replace(/^(?:install|replace|run)\s+/i, "").trim();
  if (flags.disconnectScope && (!directObject || /\baffected areas\b/i.test(directObject))) directObject = "disconnect";
  if (flags.disconnectScope && directObject && !/\bdisconnect\b/i.test(directObject)) directObject = `${directObject} disconnect`;
  if (flags.breakerScope && directObject && !/\bbreakers?\b/i.test(directObject)) directObject = `${directObject} breakers`;
  if (flags.conduitScope && directObject && !/\bconduit\b/i.test(directObject)) directObject = `${directObject} conduit`;
  const includeLocationSuffix = location && !new RegExp(`\\b${location.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(directObject);
  const warehouseContext = /\bwarehouse\b|\bcommercial\b/i.test(`${coreScopeText} ${rawWorkPhrase} ${technicalItem}`);
  const rooftopContext = flags.rooftopScope || /\brooftop\b|\bpackage unit\b|\brtu\b/i.test(`${coreScopeText} ${rawWorkPhrase} ${technicalItem}`);
  const tenantImprovementContext = flags.tenantImprovementScope || /\btenant improvement\b|\bti\b/i.test(`${coreScopeText} ${rawWorkPhrase} ${technicalItem}`);

  let directLine = ensureSentence(
    `${directLead} ${directObject}`.replace(/\s+/g, " ").trim()
      + `${includeLocationSuffix ? buildLocationSuffix(location) : ""}`
  );
  let processLine = ensureSentence("Coordinate the described technical work within accessible areas, verify operation, and clean up the work area");
  let environmentLine = "";
  let qualifierLine = renderExclusionSentence(
    explicitExclusion || fallbackExclusion || "shutdown coordination, code-driven changes, and work outside the identified scope are not included unless identified and approved"
  );

  if (flags.breakerScope) {
    directLine = ensureSentence(
      `${directLead} ${directObject}`.replace(/\s+/g, " ").trim()
        + `${includeLocationSuffix ? buildLocationSuffix(location) : ""}`
        + " and complete accessible breaker terminations and identification as required"
    );
    processLine = ensureSentence(
      warehouseContext
        ? "Coordinate access to the affected commercial gear, verify breaker operation after installation, and clean up the work area"
        : "Coordinate access to the affected electrical gear, verify breaker operation after installation, and clean up the work area"
    );
    environmentLine = warehouseContext
      ? ensureSentence("Keep the work within the identified warehouse or commercial area and the stated breaker scope")
      : "";
    qualifierLine = renderExclusionSentence(
      explicitExclusion || fallbackExclusion || "panel modifications beyond the identified breaker scope, feeder changes, and unforeseen code-driven upgrades are not included unless identified and approved"
    );
  } else if (flags.disconnectScope) {
    directLine = ensureSentence(
      `${directLead} ${directObject}`.replace(/\s+/g, " ").trim()
        + `${includeLocationSuffix ? buildLocationSuffix(location) : ""}`
        + (
          replacementScope
            ? " and reconnect accessible conductors required for the disconnect replacement"
            : " and complete accessible terminations, mounting, and service connections required for the described disconnect scope"
        )
    );
    processLine = ensureSentence(
      installationOnlyScope
        ? "Coordinate safe access as required, complete identification, verify operation, and clean up the work area"
        : "Coordinate equipment shutdown or safe access as required, complete identification, verify operation, and clean up the work area"
    );
    environmentLine = rooftopContext
      ? ensureSentence(`Limit work to accessible rooftop equipment connections within the stated ${replacementScope ? "replacement" : "disconnect installation"} scope`)
      : "";
    qualifierLine = renderExclusionSentence(
      explicitExclusion || fallbackExclusion || "conductors beyond accessible disconnect terminations, equipment repairs, and unforeseen code-driven upgrades are not included unless identified and approved"
    );
  } else if (flags.conduitScope) {
    directLine = ensureSentence(
      `${directLead} ${directObject}`.replace(/\s+/g, " ").trim()
        + `${includeLocationSuffix ? buildLocationSuffix(location) : ""}`
        + " with required bends, supports, and terminations for the described run"
    );
    processLine = ensureSentence("Coordinate routing in accessible areas and leave the conduit run ready for follow-on electrical work");
    environmentLine = tenantImprovementContext
      ? ensureSentence("Keep the routing within the identified tenant improvement area and the stated conduit path")
      : "";
    qualifierLine = renderExclusionSentence(
      explicitExclusion || fallbackExclusion || "wire pull, device terminations, major demolition, and work outside the identified conduit route are not included unless identified and approved"
    );
  }

  return uniqueList([directLine, processLine, environmentLine, qualifierLine]).filter(Boolean);
}

function buildTechnicalScopeLines(analysis) {
  const coreScopeText = normalizeScopePhrase(analysis?.coreScopeText || "");
  const rawWorkPhrase = normalizeScopePhrase(
    firstSkeletonValue(analysis, "directWork", "certain")
    || analysis?.coreScopeText
    || resolvePrimaryScopePhrase(analysis)
  );
  const technicalItem = normalizeScopePhrase(
    (Array.isArray(analysis?.items) ? analysis.items : []).find((item) => /\bstainless\b|\blines?\b|\btub(?:e|ing)\b|\bpiping\b|\binstrument(?:ation)?\b|\bpanel\b/i.test(item))
    || rawWorkPhrase
    || resolvePrimaryScopePhrase(analysis)
  )
    .replace(/\b\d+(?:\.\d+)?\s*(?:feet|foot|ft)\b/ig, "")
    .replace(/\s+\d+\s*$/g, "")
    .replace(/^(?:install|replace|remove|weld|tie-in)\s+/i, "")
    .trim();
  const footage = normalizeScopePhrase(
    (Array.isArray(analysis?.quantityItemPairs) ? analysis.quantityItemPairs : []).find((value) => /\b(?:feet|foot|ft)\b/i.test(value))
  );
  const location = Array.isArray(analysis?.locations) ? analysis.locations[0] : "";
  const explicitExclusion = firstSkeletonValue(analysis, "exclusions", "certain");
  const fallbackExclusion = firstSkeletonValue(analysis, "exclusions", "riskyMissing");
  const actions = Array.isArray(analysis?.actions) ? analysis.actions : [];
  const signals = uniqueList(analysis?.technicalSignals || []);
  const technicalFlags = getTechnicalSubtypeFlags(analysis);
  const orbitalScope = Array.isArray(analysis?.technicalSignals) && analysis.technicalSignals.includes("orbital welding");
  const panelScope = technicalFlags.panelScope;
  const tubingScope = technicalFlags.tubingScope || /\btub(?:e|ing)\b|\bpiping\b|\blines?\b/i.test(technicalItem);

  if (technicalFlags.siteEquipmentScope && !orbitalScope && !panelScope && !tubingScope) {
    return buildSiteEquipmentTechnicalScopeLines(analysis, technicalFlags);
  }
  if (technicalFlags.electricalCommercialScope && !orbitalScope && !panelScope && !tubingScope) {
    return buildElectricalCommercialTechnicalScopeLines(analysis, technicalFlags);
  }
  const directLead = orbitalScope
    ? "Perform orbital welding"
    : panelScope
      ? "Complete"
      : actions.includes("install")
        ? "Install"
        : actions.includes("tie-in")
          ? "Complete"
          : "Perform";
  const directObject = orbitalScope && footage && technicalItem
    ? `${footage} of ${technicalItem}`
    : panelScope && /\binstrument(?:ation)?\b/i.test(coreScopeText)
      ? coreScopeText
      : panelScope && signals.includes("instrumentation") && /^tie(?:-| )?in\b/i.test(rawWorkPhrase)
        ? `instrumentation ${rawWorkPhrase}`
      : technicalItem || rawWorkPhrase || "the stated work";
  const normalizedObject = directLead === "Complete" && /^complete\b/i.test(directObject)
    ? directObject.replace(/^complete\s+/i, "")
    : directObject;
  const includeLocationSuffix = location && !new RegExp(`\\b${location.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(normalizedObject);

  const directLine = ensureSentence(
    `${directLead} ${directLead === "Perform orbital welding" ? "on" : ""} ${normalizedObject}`.replace(/\s+/g, " ").trim()
      + `${includeLocationSuffix ? buildLocationSuffix(location) : ""}`
  );
  const processLine = ensureSentence(
    panelScope
      ? "Complete accessible tie-in work, terminations, and identified panel connections within the stated scope"
      : tubingScope
        ? "Complete fit-up, alignment, and accessible runs within the stated work area"
        : "Complete specialty execution within the stated work area using the identified technical scope"
  );
  const environmentLine = ensureSentence(
    panelScope
      ? "Limit work to accessible tie-in areas at the identified panel location"
      : hasTechnicalEnvironmentRequirement(analysis)
        ? "Limit work to accessible areas within the stated technical environment and scope limits"
        : ""
  );
  const qualifierLine = renderExclusionSentence(
    explicitExclusion || (
      panelScope
        ? "shutdown coordination, live-system work, testing, programming, and revisions outside the stated tie-in scope are not included unless specifically identified and approved"
        : fallbackExclusion || "specialty QA/QC requirements, testing, shutdown coordination, and work outside the stated limits are not included unless specifically identified and approved"
    )
  );

  return uniqueList([directLine, processLine, environmentLine, qualifierLine]).filter(Boolean);
}

function buildFixtureScopeLines(analysis) {
  const certainWork = getSkeletonValues(analysis, "directWork", "certain").map(normalizeScopePhrase);
  const impliedWork = getSkeletonValues(analysis, "directWork", "implied").map(normalizeScopePhrase);
  const completion = getSkeletonValues(analysis, "completionStandards", "certain")
    .concat(getSkeletonValues(analysis, "completionStandards", "implied"))
    .map(normalizeScopePhrase);
  const explicitExclusion = firstSkeletonValue(analysis, "exclusions", "certain");
  const contingency = explicitExclusion || firstSkeletonValue(analysis, "exclusions", "riskyMissing") || buildContingencyScopeLine(analysis);

  const directParts = uniqueList([
    ...certainWork,
    ...impliedWork.filter((value) => /\breconnect supply lines?\b/i.test(value)),
  ]).filter(Boolean);
  const completionParts = uniqueList(
    completion.filter((value) => /\btest\b|\bclean up\b/i.test(value))
  );

  return uniqueList([
    ensureSentence(capitalizePhrase(joinPlainPhrases(directParts))),
    ensureSentence(capitalizePhrase(joinPlainPhrases(completionParts))),
    renderExclusionSentence(contingency),
  ]).filter(Boolean);
}

function buildRiskAwareScopeLines(analysis) {
  return uniqueList([
    buildDirectScopeLine(analysis),
    buildRepairScopeLine(analysis),
    buildContingencyScopeLine(analysis),
  ]).filter(Boolean);
}

function buildRoofingScopeLines(analysis) {
  const actions = Array.isArray(analysis?.actions) ? analysis.actions : [];
  const replacementScope = actions.includes("replace");
  const removalScope = (actions.includes("remove") || actions.includes("demo")) && !replacementScope;
  const installScope = actions.includes("install") && !replacementScope && !removalScope;
  const roofTarget = "existing roof covering";
  const accessLine = analysis?.impliedAccessContext === "rooftop_access"
    ? "Coordinate rooftop access or safe shutdown conditions as required"
    : "Coordinate roof access and fall protection as required";

  const directLine = replacementScope
    ? ensureSentence(`Remove and replace the ${roofTarget} within the stated roof area`)
    : removalScope
      ? ensureSentence(`Remove the ${roofTarget} within the stated roof area`)
      : installScope
        ? ensureSentence(`Install the stated roof covering within the stated roof area`)
        : ensureSentence(`Perform the stated roofing work within the stated roof area`);

  const processLine = replacementScope
    ? "Prepare the roof deck and perimeter edges as required, complete flashing, membrane, or weatherproofing tie-in where directly affected, and clean up the work area."
    : removalScope
      ? "Protect the exposed roof area as needed, remove incidental debris, and clean up the work area."
      : installScope
        ? "Prepare the roof deck as needed, complete flashing or weatherproofing tie-in where directly affected, and clean up the work area."
        : "Complete the described roofing work, verify perimeter tie-in where directly affected, and clean up the work area.";

  const qualifierLine = renderExclusionSentence(
    "hidden decking deterioration, structural repairs, and code-driven upgrades beyond the direct roofing scope are not included unless identified and approved"
  );

  return uniqueList([directLine, accessLine, processLine, qualifierLine]).filter(Boolean);
}

function resolveScopeProfile(analysis) {
  const workBucket = analysis?.scopeWorkBucket || resolveScopeWorkBucket(analysis);
  const scopeAssetCategory = analysis?.scopeAssetCategory || resolveScopeAssetCategory(analysis);
  if (hasTechnicalScopeSignals(analysis)) return "technical";
  if (hasCorpusMatch(analysis, /\b(?:re)?paint(?:ed|ing)?\b|\bprime(?:d|ing)?\b/i)) return "painting";
  if (workBucket === "finish_coating" && hasCorpusMatch(analysis, FINISH_SURFACE_ASSET_REGEX)) return "finish_scope";
  if (hasCorpusMatch(analysis, /\btoilet(?:s)?\b/i)) return "toilet";
  if (hasCorpusMatch(analysis, /\bdrywall\b/i) && ((Array.isArray(analysis?.actions) ? analysis.actions : []).includes("patch") || (Array.isArray(analysis?.actions) ? analysis.actions : []).includes("demo") || (Array.isArray(analysis?.actions) ? analysis.actions : []).includes("repair"))) {
    return "drywall";
  }
  if (hasFinishCarpentryScopeSignals(analysis)) return "finish_carpentry";
  if (hasRoofingScopeSignals(analysis)) return "roofing";
  if (analysis?.resetIntent && (analysis?.replaceableAssetScope || hasReplaceableAssetScopeSignals(analysis))) return "equipment_asset";
  if (analysis?.resetIntent && resolveUniversalScopePlan(analysis).eligible) return "universal_scope";
  if (workBucket === "repair_patch") return "repair_scope";
  if (hasCorpusMatch(analysis, /\bvanity\b/i) && !hasCorpusMatch(analysis, /\bfaucet\b|\bsink\b|\bsupply lines?\b|\bdrain\b/i)) {
    return "vanity";
  }
  if (hasCorpusMatch(analysis, /\bowner[-\s]?supplied\b|\bcustomer[-\s]?supplied\b|\b(?:vanity\s+)?faucet(?:s)?\b|\bvanity\b|\bsink\b|\bplumbing fixtures?\b/i)) {
    return "fixture";
  }
  if (hasRoofingScopeSignals(analysis)) return "roofing";
  if (
    hasActionFamily(analysis, "replace_changeout")
    && (
      scopeAssetCategory === "door_hardware"
      || hasCorpusMatch(analysis, DOOR_HARDWARE_ASSET_REGEX)
    )
  ) {
    return "equipment_asset";
  }
  if (scopeAssetCategory === "door_hardware" && (analysis?.replaceableAssetScope || hasReplaceableAssetScopeSignals(analysis))) {
    return "equipment_asset";
  }
  if (resolveUniversalScopePlan(analysis).eligible) return "universal_scope";
  if (analysis?.replaceableAssetScope || hasReplaceableAssetScopeSignals(analysis)) return "equipment_asset";
  if (hasRiskAwareScopeSignals(analysis)) return "risk";
  return "generic";
}

function buildScopeEngineLines(analysis) {
  const profile = resolveScopeProfile(analysis);
  if (profile === "technical") return buildTechnicalScopeLines(analysis);
  if (profile === "painting") return buildPaintingScopeLines(analysis);
  if (profile === "finish_scope") return buildFinishScopeLines(analysis);
  if (profile === "toilet") return buildToiletScopeLines(analysis);
  if (profile === "drywall") return buildDrywallScopeLines(analysis);
  if (profile === "repair_scope") return buildRepairPatchScopeLines(analysis);
  if (profile === "finish_carpentry") return buildFinishCarpentryScopeLines(analysis);
  if (profile === "vanity") return buildVanityScopeLines(analysis);
  if (profile === "fixture") return buildFixtureScopeLines(analysis);
  if (profile === "roofing") return buildRoofingScopeLines(analysis);
  if (profile === "universal_scope") return buildUniversalScopeLines(analysis);
  if (profile === "equipment_asset") return buildReplaceableAssetScopeLines(analysis);
  if (profile === "risk") return buildRiskAwareScopeLines(analysis);
  const inferredFallbackLines = buildSignalDrivenFallbackLines(analysis);
  if (inferredFallbackLines.length) return inferredFallbackLines;
  return buildGenericScopeLines(analysis);
}

export function buildRiskAwareScopeEchoFallback({ analysis = {} } = {}) {
  const lines = buildScopeEngineLines(analysis);
  if (!lines.length) return "";
  return formatScopeLines(lines, analysis);
}

export function resolveScopeAssistNotes(rawResponse, { userInput = "", context = null } = {}) {
  const scopeNotes = extractScopeAssistText(rawResponse);
  if (!scopeNotes) return "";

  const analysis = context?.scopeInputAnalysis && typeof context.scopeInputAnalysis === "object"
    ? context.scopeInputAnalysis
    : analyzeScopeAssistInput(userInput);

  const enriched = buildRiskAwareScopeEchoFallback({ analysis });
  if (
    enriched
    && (
      isWeakRiskAwareScopeEcho(scopeNotes, { userInput, analysis })
      || shouldPreferRicherScopeRewrite(scopeNotes, { userInput, analysis })
    )
  ) {
    return formatDefaultContractorScopeNotes(enriched, analysis);
  }

  return formatDefaultContractorScopeNotes(scopeNotes, analysis);
}

export function summarizeScopeAssistSoftBias(analysis = {}, userInput = "") {
  const resolvedAnalysis = analysis && typeof analysis === "object" ? analysis : {};
  const rawPrompt = sanitizeScopeAssistText(
    resolvedAnalysis?.coreScopeText || resolvedAnalysis?.rawScopeText || userInput
  );
  const biasFields = uniqueList([
    ...(Array.isArray(resolvedAnalysis?.technicalSignals) ? resolvedAnalysis.technicalSignals : []),
    ...(Array.isArray(resolvedAnalysis?.commercialContextSignals) ? resolvedAnalysis.commercialContextSignals : []),
    resolvedAnalysis?.scopeProfile || "",
    resolvedAnalysis?.scopeTradeBucket || "",
    resolvedAnalysis?.scopeWorkBucket || "",
    resolvedAnalysis?.scopeAssetCategory || "",
    resolvedAnalysis?.scopeAssetFamily || "",
    resolvedAnalysis?.objectType || "",
    resolvedAnalysis?.connectionModel || "",
    resolvedAnalysis?.assemblyScale || "",
  ]);
  const specialtyProfiles = new Set([
    "technical",
    "painting",
    "finish_scope",
    "toilet",
    "drywall",
    "repair_scope",
    "finish_carpentry",
    "vanity",
    "fixture",
    "roofing",
    "equipment_asset",
    "risk",
  ]);
  const generationPath = resolvedAnalysis?.scopeProfile === "universal_scope"
    ? "universal-biased"
    : specialtyProfiles.has(String(resolvedAnalysis?.scopeProfile || "").trim())
      ? "specialty-biased"
      : biasFields.length
        ? "universal-biased"
        : "raw-input-first";

  return {
    rawPrompt,
    softTaxonomyBiasFound: biasFields.length > 0,
    generationPath,
    biasFields,
  };
}

export function sanitizeScopeAssistText(value) {
  const normalized = stripScopeAssistLeadIn(
    stripRedundantScopeLabel(
      restoreEscapedLineBreaks(stripCodeFences(unwrapQuotedScopeText(value)))
    )
  );
  if (!normalized) return "";

  return normalized
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractScopeAssistText(rawResponse) {
  if (typeof rawResponse === "string") return sanitizeScopeAssistText(rawResponse);
  if (!rawResponse || typeof rawResponse !== "object") return "";
  return sanitizeScopeAssistText(
    rawResponse?.scopeNotes
    || rawResponse?.text
    || rawResponse?.content
    || rawResponse?.notes
    || rawResponse?.result
    || ""
  );
}

function toProjectTitleCase(value) {
  return sanitizeScopeAssistText(value)
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => {
      if (/^(frp|vct|rtu|hvac)$/i.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function resolveProjectTitleSubject(analysis = {}, corpus = "") {
  const normalized = sanitizeScopeAssistText(corpus || analysis?.coreScopeText || analysis?.rawScopeText);
  const hasBathroomContext = /\bbath(?:room)?\b|\brestroom\b/i.test(normalized);
  const hasHouseContext = /\bhouse\b|\bhome\b/i.test(normalized);

  if (hasRoofingScopeSignals(analysis) || /\broof(?:ing| cover(?:ing|ings?)?| system| deck)?\b|\bre-?roof\b|\breroof\b/i.test(normalized)) return "Roof";
  if (/\broof hatch(?:es)?\b|\bhatch(?:es)?\b/i.test(normalized)) return "Roof Hatch";
  if (/\bwater heater(?:s)?\b|\btankless water heater(?:s)?\b/i.test(normalized)) return "Water Heater";
  if (/\bceiling tiles?\b|\bacoustic ceiling tiles?\b/i.test(normalized)) return "Ceiling Tile";
  if (/\btile(?:s)?\b/i.test(normalized)) {
    if (hasBathroomContext) return "Bathroom Tile";
    if (/\bfloor\b/i.test(normalized)) return "Floor Tile";
    return "Tile";
  }
  if (/\bpaint(?:ed|ing)?\b|\brepaint\b|\bprime(?:d|ing)?\b/i.test(normalized) || analysis?.scopeProfile === "painting") {
    if (/\bexterior\b/i.test(normalized) || hasSiteExteriorScopeSignals(analysis)) return "Exterior";
    if (/\binterior\b/i.test(normalized)) return "Interior";
    if (hasBathroomContext) return "Bathroom";
    if (hasHouseContext || analysis?.residentialContext) return "House";
    return "Painting";
  }
  if (/\bvanit(?:y|ies)\b/i.test(normalized)) return hasBathroomContext ? "Bathroom Vanity" : "Vanity";
  if (/\btoilet(?:s)?\b/i.test(normalized)) return hasBathroomContext ? "Bathroom Toilet" : "Toilet";
  if (/\bfaucet(?:s)?\b/i.test(normalized)) return "Faucet";
  if (/\bman door(?:s)?\b/i.test(normalized)) return "Man Door";
  if (/\bdoor(?:s)?\b/i.test(normalized)) return "Door";
  if (/\bwindow(?:s)?\b/i.test(normalized)) return "Window";
  if (/\bstorefront glass\b|\bstorefront\b|\bglazing\b/i.test(normalized)) return "Storefront Glass";
  if (/\bfence section(?:s)?\b/i.test(normalized)) return "Fence Section";
  if (/\bfence\b/i.test(normalized)) return "Fence";
  if (/\bgate(?:s)?\b/i.test(normalized)) return "Gate";
  if (/\brailing(?:s)?\b|\bhandrail(?:s)?\b/i.test(normalized)) return /\bhandrail(?:s)?\b/i.test(normalized) ? "Handrail" : "Railing";
  if (/\blight pole(?:s)?\b|\bpole light(?:s)?\b/i.test(normalized)) return "Light Pole";
  if (/\bcabinet(?:ry|s)?\b|\bcasework\b|\bmillwork\b/i.test(normalized)) return "Cabinet";
  if (/\bdrywall\b/i.test(normalized)) return "Drywall";
  if (/\bstucco\b/i.test(normalized)) return "Stucco";
  if (/\bfrp\b/i.test(normalized)) return "FRP";
  if (/\bawning(?:s)?\b/i.test(normalized)) return "Awning";

  const preferredObjectPhrase = resolvePreferredObjectPhrase(analysis) || resolvePrimaryScopePhrase(analysis);
  return toProjectTitleCase(preferredObjectPhrase || normalized);
}

function resolveProjectTitleActionNoun(analysis = {}, subject = "") {
  const normalized = sanitizeScopeAssistText(analysis?.coreScopeText || analysis?.rawScopeText || "");
  const family = analysis?.primaryActionFamily || resolvePrimaryActionFamily(analysis);
  const subjectLower = String(subject || "").toLowerCase();

  if (subjectLower.includes("tile")) {
    if (family === "replace_changeout") return "Replacement";
    if (family === "repair_patch") return "Repair";
    if (family === "remove_demo") return "Removal";
    return "Work";
  }

  if (subjectLower === "roof" || subjectLower === "roof hatch" || subjectLower === "water heater") {
    if (family === "replace_changeout") return "Replacement";
    if (family === "install_add_mount") return "Installation";
    if (family === "repair_patch") return "Repair";
    if (family === "remove_demo") return "Removal";
    return "Work";
  }

  if (subjectLower === "house" || subjectLower === "interior" || subjectLower === "exterior" || subjectLower === "painting") {
    if (family === "finish_coating" || /\bpaint(?:ed|ing)?\b|\brepaint\b|\bprime(?:d|ing)?\b/i.test(normalized)) return "Repaint";
    return "Painting";
  }

  if (family === "replace_changeout") return "Replacement";
  if (family === "install_add_mount") return "Installation";
  if (family === "repair_patch") return "Repair";
  if (family === "remove_demo") return "Removal";
  if (family === "finish_coating") return "Finish";
  return "Work";
}

export function deriveProjectNameFromScopeFlow({ scopeNotes = "", userInput = "", analysis = null } = {}) {
  const resolvedAnalysis = analysis && typeof analysis === "object"
    ? analysis
    : analyzeScopeAssistInput([scopeNotes, userInput].filter(Boolean).join(" "));
  const corpus = sanitizeScopeAssistText([
    scopeNotes,
    userInput,
    resolvedAnalysis?.coreScopeText,
    resolvedAnalysis?.rawScopeText,
    ...(Array.isArray(resolvedAnalysis?.items) ? resolvedAnalysis.items : []),
    ...(Array.isArray(resolvedAnalysis?.actionItemPhrases) ? resolvedAnalysis.actionItemPhrases : []),
  ].filter(Boolean).join(" "));
  if (!corpus) return "";

  const subject = resolveProjectTitleSubject(resolvedAnalysis, corpus);
  if (!subject) return "";

  const actionNoun = resolveProjectTitleActionNoun(resolvedAnalysis, subject);
  const title = toProjectTitleCase(`${subject} ${actionNoun}`.trim());
  return title.length > 44 ? title.slice(0, 44).replace(/\s+\S*$/, "").trim() : title;
}

// Pass 16/17 — Shared specialty-trade live-path fallback hardening
const SPECIALTY_FALLBACK_WELDING_PROCESS_LABELS = {
  gtaw_tig: "TIG welding",
  gmaw_mig: "MIG welding",
  smaw_stick: "stick welding",
  fcaw: "flux-core welding",
  saw_submerged: "submerged arc welding",
  laser_welding: "laser welding",
  electron_beam_welding: "electron beam welding",
  resistance_welding: "resistance welding",
  plasma_arc_welding: "plasma arc welding",
  thermit_welding: "thermit welding",
  stud_welding: "stud welding",
  friction_welding: "friction welding",
  ultrasonic_welding: "ultrasonic welding",
  welding_generic: "welding",
};
const SPECIALTY_FALLBACK_IRONWORK_FAMILY_LABELS = {
  structural_steel_erection: "Structural steel erection",
  miscellaneous_metals: "Miscellaneous metals",
  reinforcing_rebar: "Reinforcing — rebar",
  bridge_ironwork: "Bridge ironwork",
  pre_engineered_metal_building: "Pre-engineered metal building",
  precast_panel_connection: "Precast panel connections",
  tank_and_specialty_erection: "Tank and specialty erection",
  metal_decking: "Metal decking",
  ornamental_ironwork: "Ornamental ironwork",
  stairs_and_rails: "Stairs and rails",
  fencing_and_gates: "Fencing and gates",
  ladders_platforms_access: "Ladders, platforms, and access",
  retrofit_rehab_modification: "Retrofit and rehabilitation",
  supports_frames_canopies: "Supports, frames, and canopies",
};
const SPECIALTY_FALLBACK_IRONWORK_OP_VERBS = {
  erection_placement: "erect",
  bolt_up_connections: "bolt up",
  field_weld_connections: "field weld",
  rigging_hoisting_signaling: "rig and hoist",
  layout_alignment: "lay out",
  shop_fabrication: "fabricate",
  reinforcing_operation: "place and tie",
  repair_retrofit_op: "repair and retrofit",
};
const SPECIALTY_FALLBACK_ROUGH_FRAMING_REGEX = /\b(?:studs?|blocking|headers?|rafters?|nailers?|ledger|rough\s+fram(?:e|ing)|wood\s+fram(?:e|ing)|lumber|cripples?|trimmers?|top\s+plate|bottom\s+plate)\b/i;
const SPECIALTY_FALLBACK_CARPENTRY_FAMILY_LABELS = {
  door_installation: "Door installation",
  formwork_concrete: "Concrete formwork",
  stair_work: "Stair work",
  sheathing_subfloor: "Sheathing and subfloor",
  rough_framing: "Rough framing",
  trim_molding: "Trim and molding",
  finish_carpentry_casework: "Finish carpentry",
  general_carpentry: "General carpentry",
};
const SPECIALTY_FALLBACK_CARPENTRY_OP_VERBS = {
  hang_install: "hang and install",
  frame_out: "frame out",
  trim_finish: "trim and finish",
  patch_repair: "patch and repair",
  strip_form: "strip",
  set_form: "set",
  shim_align: "shim and align",
  replace_changeout: "replace",
};

export function buildSpecialtyLocalFallbackNote(analysis = {}) {
  // — Welding path —
  const weldBase = analysis?.weldingBaseProcess;
  const weldConf = analysis?.weldingConfidence;
  if (weldBase && (weldConf === "medium" || weldConf === "high")) {
    const secondary = analysis?.weldingSecondaryTags || [];
    const material = analysis?.weldingMaterialContext || [];
    const bias = analysis?.weldingScopeBias || [];
    const baseLabel = SPECIALTY_FALLBACK_WELDING_PROCESS_LABELS[weldBase] || weldBase.replace(/_/g, " ");
    const prefix = secondary.includes("orbital_welding")
      ? "Orbital "
      : secondary.includes("sanitary_tube_welding")
        ? "Sanitary tube "
        : "";
    const header = `${prefix}${baseLabel}`;

    // Pass 21: verb-led phrase composition — "Perform [process] at/on [object]."
    const objectParts = [];
    if (material.includes("gas_panel") || secondary.includes("gas_panel_welding")) objectParts.push("gas panels");
    if (material.includes("quarter_inch_tubing")) objectParts.push("1/4-inch tubing");
    else if (secondary.includes("tube_welding_application") && !objectParts.length) objectParts.push("tubing");
    if (material.includes("line_connections") && !objectParts.length) objectParts.push("line connections");
    const hasTubingObj = objectParts.some((p) => p.includes("tubing"));
    const stainlessSuffix = material.includes("stainless") && !objectParts.some((p) => p.includes("stainless")) && !hasTubingObj ? ", on stainless material" : "";
    const processSuffix = secondary.includes("backpurge_welding") ? ", purge-controlled" : secondary.includes("pulse_mode_welding") ? ", pulse mode" : "";
    // Lowercase prefix only; preserve baseLabel casing (acronyms like TIG, MIG stay capitalized)
    const processPhrase = prefix ? `${prefix.toLowerCase().trim()} ${baseLabel}` : baseLabel;
    const isOrbital = secondary.includes("orbital_welding");
    const isTubeApp = secondary.includes("tube_welding_application") || secondary.includes("sanitary_tube_welding");
    const isSanitary = secondary.includes("sanitary_tube_welding");
    const hasLineConn = material.includes("line_connections");
    const hasGasPanel = material.includes("gas_panel") || secondary.includes("gas_panel_welding");
    const hasQtrTubing = material.includes("quarter_inch_tubing");
    // Pass 22: deep semantic expansion — infer work shape beyond bare classification
    if (isOrbital && hasLineConn) {
      // orbital + line context → connection-aware, tie-in-aware expansion
      return `Perform ${processPhrase} at line connections, tie-in joints, and connection points${processSuffix}.`;
    }
    if (isOrbital && isTubeApp && hasGasPanel && hasQtrTubing) {
      return `Perform ${processPhrase} at gas panel connections and 1/4-inch tubing weld points${stainlessSuffix}${processSuffix}.`;
    }
    if (isOrbital && isTubeApp) {
      // orbital + tube → tube connection and joint expansion
      const tubeObj = hasQtrTubing ? "1/4-inch tubing connections, weld joints, and tie-in points" : "tube connections, weld joints, and tie-in points";
      return `Perform ${processPhrase} on ${tubeObj}${stainlessSuffix}${processSuffix}.`;
    }
    if (isOrbital && hasGasPanel) {
      // orbital + gas panels → panel connection expansion
      return `Perform ${processPhrase} at gas panel connections and related weld points${stainlessSuffix}${processSuffix}.`;
    }
    if (isOrbital) {
      // orbital generic → connection point and tie-in expansion
      return `Perform ${processPhrase} at connection points, tie-ins, and weld joints along the system${stainlessSuffix}${processSuffix}.`;
    }
    if (isSanitary) {
      // sanitary tube → hygienic joint expansion
      return `Perform ${processPhrase} on tube connections, weld joints, and hygienic tie-in points${stainlessSuffix}${processSuffix}.`;
    }
    if (isTubeApp) {
      // tube welding (non-orbital) → joint and tie-in expansion
      const tubeObj = hasQtrTubing ? "1/4-inch tubing connections, weld joints, and tie-in points" : "tube connections, weld joints, and tie-in points";
      return `Perform ${processPhrase} on ${tubeObj}${stainlessSuffix}${processSuffix}.`;
    }
    if (hasGasPanel) {
      return `Perform ${processPhrase} at gas panel connections and related weld points${stainlessSuffix}${processSuffix}.`;
    }
    if (hasLineConn) {
      // line connections (non-orbital) → tie-in and weld location expansion
      return `Perform ${processPhrase} at line connections, tie-in joints, and weld locations${processSuffix}.`;
    }
    if (material.includes("stainless")) {
      return `Perform ${processPhrase} on stainless material connections and weld joints${processSuffix}.`;
    }
    // generic → implied work-shape expansion
    return `Perform ${processPhrase} work, including connections, joints, and weld locations${processSuffix}.`;
  }

  // — Ironwork path —
  const iwFamily = analysis?.ironworkTradeFamily;
  const iwConf = analysis?.ironworkConfidence;
  if (iwFamily && (iwConf === "medium" || iwConf === "high")) {
    const ops = analysis?.ironworkOperationTags || [];
    const objs = analysis?.ironworkObjectTags || [];
    const bias = analysis?.ironworkScopeBias || [];
    const familyLabel = SPECIALTY_FALLBACK_IRONWORK_FAMILY_LABELS[iwFamily] || iwFamily.replace(/_/g, " ");

    // Pass 21: verb-led phrase composition
    const opVerbs = ops.slice(0, 2).map((op) => SPECIALTY_FALLBACK_IRONWORK_OP_VERBS[op] || op.replace(/_/g, " ")).filter(Boolean);
    const objs3 = objs.slice(0, 3).map((o) => o.replace(/_/g, " "));
    const objPhrase = objs3.length === 0 ? "" : objs3.length === 1 ? objs3[0] : objs3.length === 2 ? `${objs3[0]} and ${objs3[1]}` : `${objs3[0]}, ${objs3[1]}, and ${objs3[2]}`;
    const biasPhrase = bias.includes("canopy_context") ? " at canopy frame" : bias.includes("bridge_context") ? " at bridge structure" : bias.includes("tank_context") ? " at tank shell" : "";
    if (opVerbs.length && objPhrase) {
      const lead = opVerbs[0].charAt(0).toUpperCase() + opVerbs[0].slice(1);
      const rest = opVerbs.slice(1);
      const verbPhrase = rest.length ? `${lead} and ${rest.join(" and ")}` : lead;
      return `${verbPhrase} ${objPhrase}${biasPhrase}.`;
    }
    if (opVerbs.length) {
      const lead = opVerbs[0].charAt(0).toUpperCase() + opVerbs[0].slice(1);
      return `${lead}${biasPhrase}.`;
    }
    if (objPhrase) return `Install ${objPhrase}${biasPhrase}.`;
    return `Complete ${familyLabel.toLowerCase()} ironwork scope as described.`;
  }

  // — Carpentry path (normalized) —
  const carpFamily = analysis?.carpentryTradeFamily;
  const carpConf = analysis?.carpentryConfidence;
  if (carpFamily && (carpConf === "medium" || carpConf === "high")) {
    const ops = analysis?.carpentryOperationTags || [];
    const objs = analysis?.carpentryObjectTags || [];
    const familyLabel = SPECIALTY_FALLBACK_CARPENTRY_FAMILY_LABELS[carpFamily] || carpFamily.replace(/_/g, " ");
    // Pass 21: verb-led phrase composition
    const opVerbs = ops.slice(0, 2).map((op) => SPECIALTY_FALLBACK_CARPENTRY_OP_VERBS[op] || op.replace(/_/g, " ")).filter(Boolean);
    const objs3 = objs.slice(0, 3).map((o) => o.replace(/_/g, " "));
    const objPhrase = objs3.length === 0 ? "" : objs3.length === 1 ? objs3[0] : objs3.length === 2 ? `${objs3[0]} and ${objs3[1]}` : `${objs3[0]}, ${objs3[1]}, and ${objs3[2]}`;
    if (opVerbs.length && objPhrase) {
      const lead = opVerbs[0].charAt(0).toUpperCase() + opVerbs[0].slice(1);
      const rest = opVerbs.slice(1);
      const verbPhrase = rest.length ? `${lead} and ${rest.join(" and ")}` : lead;
      return `${verbPhrase} ${objPhrase}.`;
    }
    if (opVerbs.length) {
      const lead = opVerbs[0].charAt(0).toUpperCase() + opVerbs[0].slice(1);
      return `${lead}.`;
    }
    if (objPhrase) return `Install ${objPhrase}.`;
    return `Complete ${familyLabel.toLowerCase()} carpentry scope as described.`;
  }

  // — Carpentry lightweight path (legacy: raw text scan for rough framing terms) —
  const rawText = analysis?.rawScopeText || "";
  const tradeBucket = analysis?.scopeTradeBucket || "";
  // Pass 21: verb-led legacy paths
  if (SPECIALTY_FALLBACK_ROUGH_FRAMING_REGEX.test(rawText)) {
    const actions = analysis?.actions || [];
    const items = analysis?.items || [];
    const carpItems = items.filter((i) => SPECIALTY_FALLBACK_ROUGH_FRAMING_REGEX.test(i)).slice(0, 3);
    const actionVerb = actions.includes("frame") ? "Frame out" : actions.includes("install") ? "Install" : "Install";
    const itemsPhrase = carpItems.length === 0 ? "required framing components" : carpItems.length === 1 ? carpItems[0] : carpItems.length === 2 ? `${carpItems[0]} and ${carpItems[1]}` : `${carpItems[0]}, ${carpItems[1]}, and ${carpItems[2]}`;
    return `${actionVerb} ${itemsPhrase}.`;
  }
  if (tradeBucket === "finish_carpentry") {
    const actions = analysis?.actions || [];
    const items = analysis?.items || [];
    const actionVerb = actions.includes("install") ? "Install" : actions.includes("replace") ? "Replace" : "Install";
    const items3 = items.slice(0, 3);
    const objectPhrase = items3.length === 0 ? "finish carpentry components" : items3.length === 1 ? items3[0] : items3.length === 2 ? `${items3[0]} and ${items3[1]}` : `${items3[0]}, ${items3[1]}, and ${items3[2]}`;
    return `${actionVerb} ${objectPhrase}.`;
  }

  return null;
}

export const scopeAssistConfig = {
  sectionKey: "scope",
  sectionLabel: "Scope Notes",
  inputPlaceholder: 'Describe the work — e.g. "Interior repaint, 3 rooms, 2 coats, patch drywall near windows"',
  inputLabel: "What's the work?",
  generateLabel: "Generate Scope",
  allowedFields: ["scopeNotes"],
  acceptFlow: "review",
  reviewType: "scope-diff",
  writebackTargets: ["scopeNotes"],

  contextBuilder(state, options = {}) {
    const mode = normalizeScopeAssistMode(options?.mode);
    const userInput = String(options?.userInput || "").trim();
    const sourceScopePrompt = String(options?.sourcePrompt || "").trim();
    const currentScopeNotes = mode === "refine"
      ? String(
        options?.ignoreCurrentScope
          ? options?.currentScope || ""
          : (
            options?.currentScope
            || state?.scopeNotes
            || ""
          )
      ).trim()
      : "";
    const refineInstruction = String(options?.refineInstruction || userInput).trim();
    const formatIntent = String(options?.formatIntent || "").trim();

    if (mode === "refine") {
      const currentScopeAnalysis = currentScopeNotes ? analyzeScopeAssistInput(currentScopeNotes) : {};
      const sourceAnalysis = sourceScopePrompt ? analyzeScopeAssistInput(sourceScopePrompt) : {};
      const baseAnalysis = Object.keys(currentScopeAnalysis).length
        ? mergeScopeAssistAnalyses(currentScopeAnalysis, sourceAnalysis, {
          formatIntent: formatIntent || currentScopeAnalysis.formattingIntent || sourceAnalysis.formattingIntent || "",
        })
        : (Object.keys(sourceAnalysis).length ? sourceAnalysis : analyzeScopeAssistInput(refineInstruction));
      const refineAnalysis = analyzeScopeAssistInput(refineInstruction);
      const analysis = mergeScopeAssistAnalyses(baseAnalysis, refineAnalysis, { formatIntent });

      return {
        tradeKey: String(state?.tradeInsert?.key || "").trim(),
        tradeText: String(state?.tradeInsert?.text || "").trim(),
        scopeMode: mode,
        sourceScopePrompt,
        currentScopeNotes,
        refineInstruction,
        scopeFormatIntent: formatIntent,
        scopeSourceAnalysis: baseAnalysis,
        scopeRefineAnalysis: refineAnalysis,
        scopeInputAnalysis: analysis,
      };
    }

    const analysis = analyzeScopeAssistInput(userInput);
    return {
      tradeKey: String(state?.tradeInsert?.key || "").trim(),
      tradeText: String(state?.tradeInsert?.text || "").trim(),
      scopeMode: mode,
      currentScopeNotes,
      scopeInputAnalysis: analysis,
    };
  },

  // Pass 20: client-side specialty fallback — used by service.js when the provider fails (rate-limited,
  // timeout, AbortError, _assistFailed) and the local welding/ironwork/carpentry analysis is strong
  // enough to produce a contractor-natural scope note without the AI provider.
  // Returns { writes: { scopeNotes }, validation: { valid: true } } or null.
  localFallback({ context } = {}) {
    const analysis = context?.scopeInputAnalysis || {};
    const specialtyNote = buildSpecialtyLocalFallbackNote(analysis);
    if (!specialtyNote) return null;
    return { writes: { scopeNotes: specialtyNote }, validation: { valid: true } };
  },

  localAdapter(rawResponse, _state, options = {}) {
    const mode = normalizeScopeAssistMode(options?.mode);
    const rawScopeNotes = extractScopeAssistText(rawResponse);
    if (!rawScopeNotes) return null;

    if (mode !== "refine") {
      return { scopeNotes: rawScopeNotes };
    }

    const scopeNotes = resolveScopeAssistNotes(rawResponse, {
      userInput: options?.userInput,
      context: options?.context,
    });
    return scopeNotes ? { scopeNotes } : null;
  },

  validationRules(writes) {
    if (typeof writes?.scopeNotes !== "string") {
      return { valid: false, error: "No scope text was generated." };
    }
    const normalizedScope = sanitizeScopeAssistText(writes.scopeNotes);
    if (!normalizedScope) return { valid: false, error: "No scope text was generated." };
    return { valid: true };
  },
};
