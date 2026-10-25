"use client";

import { Plus, Search, Smile, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type EmojiCategory =
  | "Smileys & People"
  | "Gesture & Hands"
  | "Animals & Nature"
  | "Food & Drink"
  | "Activity & Sports"
  | "Travel & Places"
  | "Objects"
  | "Symbols & Flags";

type EmojiEntry = { emoji: string; keywords: string; category: EmojiCategory };

const CATEGORY_DATA: Record<string, string> = {
  "Smileys & People": `😀|grinning face smile happy;😃|grinning face big eyes;😄|grinning face smiling eyes;😁|beaming grin;😆|laughing squint;😅|grin sweat relieved;🤣|rolling floor laughing rofl;😂|face tears joy laugh;🙂|slight smile;🙃|upside down silly;🫠|melting hot embarrassed;😉|wink;😊|blush happy smile;😇|halo angel innocent;🥰|smiling hearts love;😍|heart eyes adore;🤩|star struck excited;😘|kiss heart;😗|kissing face;☺️|smile relaxed;😚|closed eyes kiss;😙|smiling kiss;🥲|smile tear grateful;😋|yum tasty;😛|tongue silly;😜|wink tongue joke;🤪|zany crazy;😝|squint tongue;🤑|money face rich;🤗|hug;🤭|hand mouth giggle;🫢|open eyes hand mouth;🫣|peeking shy;🤫|shush quiet;🤔|thinking hmm;🫡|salute respect;🤐|zipper mouth secret;🤨|raised eyebrow skeptical;😐|neutral face;😑|expressionless;😶|no mouth silent;🫥|dotted line invisible;😶‍🌫️|face clouds fog;😏|smirk;😒|unamused annoyed;🙄|eye roll;😬|grimace awkward;😮‍💨|sigh relief;🤥|lying pinocchio;🫨|shaking shocked;😌|relieved calm;😔|pensive sad;😪|sleepy;🤤|drooling;😴|sleeping zzz;😷|mask sick;🤒|thermometer fever ill;🤕|bandage hurt;🤢|nauseated sick;🤮|vomit;🤧|sneeze;🥵|hot fever;🥶|cold freezing;🥴|woozy drunk;😵|dizzy;😵‍💫|spiral eyes;🤯|exploding head mind blown;🤠|cowboy;🥳|party celebrate;🥸|disguise glasses;😎|sunglasses cool;🤓|nerd glasses;🧐|monocle;😕|confused;🫤|diagonal mouth unsure;😟|worried;🙁|slightly frowning;☹️|frown;😮|open mouth surprised;😯|hushed;😲|astonished;😳|flushed embarrassed;🥺|pleading puppy eyes;🥹|holding back tears;😦|frowning open mouth;😧|anguished;😨|fearful scared;😰|anxious sweat;😥|sad sweat;😢|cry tear;😭|sobbing loudly;😱|screaming fear;😖|confounded;😣|persevere;😞|disappointed;😓|downcast sweat;😩|weary;😫|tired;🥱|yawn;😤|triumph huff;😡|angry rage;😠|mad;🤬|cursing swearing;😈|devil mischievous;👿|angry devil;💀|skull dead;☠️|skull crossbones poison;💩|poop;🤡|clown;👹|ogre;👺|goblin;👻|ghost spooky;👽|alien;👾|space invader;🤖|robot;🎃|jack o lantern halloween;😺|cat grin;😸|cat smiling;😹|cat tears laughter;😻|cat heart eyes;😼|cat smirk;😽|cat kiss;🙀|cat scream;😿|cat crying;😾|pouting cat;🫶|heart hands love;🤲|palms up;👐|open hands;🙌|hands celebration;👏|clap applause;🤝|handshake deal;👍|thumbs up like yes;👎|thumbs down dislike no;👊|fist bump punch;✊|raised fist;🤛|left fist bump;🤜|right fist bump;🤞|fingers crossed luck;✌️|peace victory;🫰|finger heart;🤟|love you hand;🤘|rock on;👌|ok perfect;🤌|pinched fingers;🤏|pinching small;🫳|palm down;🫴|palm up;☝️|index up;👇|point down;👆|point up;👉|point right;👈|point left;✋|raised hand stop;🤚|back hand;🖐️|hand fingers spread;🖖|vulcan salute;👋|wave hello goodbye;🤙|call me;💪|flex strong;🦾|mechanical arm;🖕|middle finger;✍️|writing hand;🙏|pray thanks please;💅|nail polish;🤳|selfie;💃|dancing woman;🕺|dancing man;🧑‍🤝‍🧑|people holding hands;👫|woman man holding hands;👬|men holding hands;👭|women holding hands;🧑‍🧑‍🧒|family;👶|baby;🧒|child;👦|boy;👧|girl;🧑|person adult;👨|man;👩|woman;🧔|bearded person;👴|old man;👵|old woman;🧓|older person;🧑‍⚕️|health worker doctor nurse;👨‍⚕️|man doctor;👩‍⚕️|woman doctor;🧑‍🎓|student graduate;🧑‍🏫|teacher professor;🧑‍💻|technologist coder;🧑‍🚀|astronaut;🧑‍🍳|cook chef;🧑‍🎨|artist painter;🧑‍🔧|mechanic;🧑‍🚒|firefighter;🧑‍✈️|pilot;🧑‍⚖️|judge;🧑‍🌾|farmer;🧑‍🎤|singer performer;🧑‍💼|office worker;🧑‍🔬|scientist;👰|bride wedding;🤵|tuxedo groom;🤱|breastfeeding;🧘|meditation yoga;🛀|bath;🛌|person bed`,
  "Animals & Nature": `🐶|dog face puppy;🐱|cat face kitten;🐭|mouse face;🐹|hamster;🐰|rabbit bunny;🦊|fox;🐻|bear;🐼|panda;🐻‍❄️|polar bear;🐨|koala;🐯|tiger face;🦁|lion;🐮|cow face;🐷|pig face;🐸|frog;🐵|monkey face;🙈|see no evil monkey;🙉|hear no evil monkey;🙊|speak no evil monkey;🐒|monkey;🐔|chicken;🐧|penguin;🐦|bird;🐤|baby chick;🐣|hatching chick;🐥|front chick;🦆|duck;🦅|eagle;🦉|owl;🦇|bat;🐺|wolf;🐗|boar;🐴|horse face;🦄|unicorn;🐝|bee;🪲|beetle;🐛|bug caterpillar;🦋|butterfly;🐌|snail;🐞|ladybug;🐜|ant;🪰|fly;🪱|worm;🦟|mosquito;🦗|cricket;🕷️|spider;🕸️|spider web;🦂|scorpion;🐢|turtle;🐍|snake;🦎|lizard;🦖|t rex dinosaur;🦕|sauropod dinosaur;🐙|octopus;🦑|squid;🦐|shrimp;🦞|lobster;🦀|crab;🐡|blowfish;🐠|tropical fish;🐟|fish;🐬|dolphin;🐳|whale;🐋|whale;🦈|shark;🦭|seal;🐊|crocodile;🐅|tiger;🐆|leopard;🦓|zebra;🦍|gorilla;🦧|orangutan;🦣|mammoth;🐘|elephant;🦛|hippopotamus;🦏|rhinoceros;🐪|camel;🐫|two hump camel;🦒|giraffe;🦘|kangaroo;🦬|bison;🐃|water buffalo;🐂|ox;🐄|cow;🐎|horse;🐖|pig;🐏|ram;🐑|sheep;🦙|llama;🐐|goat;🦌|deer;🐕|dog;🦮|guide dog;🐕‍🦺|service dog;🐩|poodle;🦃|turkey;🦚|peacock;🦜|parrot;🦢|swan;🪿|goose;🦩|flamingo;🕊️|dove peace;🐇|rabbit;🦝|raccoon;🦨|skunk;🦡|badger;🦫|beaver;🦦|otter;🦥|sloth;🐁|mouse;🐀|rat;🐿️|chipmunk;🦔|hedgehog;🌵|cactus;🎄|christmas tree;🌲|evergreen tree;🌳|deciduous tree;🌴|palm tree;🪵|wood log;🌱|seedling sprout;🌿|herb leaf;☘️|shamrock;🍀|four leaf clover luck;🎍|pine decoration;🪴|potted plant;🎋|tanabata tree;🍃|leaves wind;🍂|fallen leaf;🍁|maple leaf autumn;🪺|nest eggs;🪹|empty nest;🍄|mushroom;🌾|rice plant;💐|bouquet flowers;🌷|tulip;🌹|rose;🥀|wilted flower;🪻|hyacinth;🪷|lotus;🌺|hibiscus;🌸|cherry blossom;🌼|blossom;🌻|sunflower;🌞|sun face;🌝|full moon face;🌛|first quarter moon face;🌜|last quarter moon face;🌚|new moon face;🌕|full moon;🌖|waning gibbous moon;🌗|last quarter moon;🌘|waning crescent moon;🌑|new moon;🌒|waxing crescent moon;🌓|first quarter moon;🌔|waxing gibbous moon;🌙|crescent moon;🌎|earth americas planet;🌍|earth europe africa;🌏|earth asia australia;🪐|saturn planet;💫|dizzy star;⭐|star;🌟|glowing star;✨|sparkles magic;🌠|shooting star;☄️|comet;🌌|milky way galaxy;☀️|sun sunny;🌤️|sun behind small cloud;⛅|sun cloud;🌥️|sun behind large cloud;☁️|cloud;🌦️|sun rain;🌧️|rain cloud;⛈️|thunderstorm;🌩️|lightning cloud;🌨️|snow cloud;❄️|snowflake;☃️|snowman;⛄|snowman no snow;🌬️|wind face;💨|dash wind;🌪️|tornado;🌫️|fog;🌈|rainbow;☔|umbrella rain;💧|droplet water;💦|sweat droplets;🌊|ocean wave;🔥|fire flame hot;🌋|volcano;🗻|mount fuji;🏔️|snow mountain;⛰️|mountain;🪨|rock stone`,
  "Food & Drink": `🍏|green apple;🍎|red apple;🍐|pear;🍊|orange tangerine;🍋|lemon;🍌|banana;🍉|watermelon;🍇|grapes;🍓|strawberry;🫐|blueberries;🍈|melon;🍒|cherries;🍑|peach;🥭|mango;🍍|pineapple;🥥|coconut;🥝|kiwi fruit;🍅|tomato;🍆|eggplant aubergine;🥑|avocado;🥦|broccoli;🥬|leafy greens lettuce;🥒|cucumber pickle;🌶️|hot pepper chili;🫑|bell pepper;🌽|corn;🥕|carrot;🫒|olive;🧄|garlic;🧅|onion;🥔|potato;🍠|sweet potato;🫚|ginger;🥐|croissant;🥯|bagel;🍞|bread loaf;🥖|baguette;🫓|flatbread pita;🥨|pretzel;🧀|cheese;🥚|egg;🍳|cooking egg;🧈|butter;🥞|pancakes;🧇|waffle;🥓|bacon;🥩|meat steak;🍗|poultry leg;🍖|meat bone;🌭|hot dog;🍔|hamburger burger;🍟|french fries;🍕|pizza;🫔|tamale;🌮|taco;🌯|burrito;🫕|fondue;🥙|stuffed flatbread kebab;🧆|falafel;🥗|green salad;🥘|shallow pan food;🍲|pot stew;🫙|jar;🍝|spaghetti pasta;🍜|ramen noodles;🍛|curry rice;🍣|sushi;🍱|bento box;🥟|dumpling;🦪|oyster;🍤|fried shrimp;🍙|rice ball;🍚|cooked rice;🍘|rice cracker;🍥|fish cake;🥠|fortune cookie;🥮|moon cake;🍢|oden;🍡|dango;🍧|shaved ice;🍨|ice cream;🍦|soft serve;🥧|pie;🧁|cupcake;🍰|cake;🎂|birthday cake;🍮|custard pudding;🍭|lollipop;🍬|candy;🍫|chocolate bar;🍿|popcorn;🍩|doughnut donut;🍪|cookie;🌰|chestnut;🥜|peanuts;🍯|honey;🥛|milk;🍼|baby bottle;☕|coffee hot drink;🫖|teapot;🍵|tea;🧃|juice box;🥤|cup straw;🧋|bubble tea boba;🧉|mate;🧊|ice;🍶|sake;🍺|beer;🍻|cheers beers;🥂|clinking glasses toast;🍷|wine;🥃|whisky glass;🍸|cocktail martini;🍹|tropical drink;🧋|boba milk tea;🍾|champagne bottle celebration;🧂|salt;🥄|spoon;🍴|fork knife;🍽️|plate fork knife;🥢|chopsticks`,
  "Travel & Places": `🚗|car automobile;🚕|taxi cab;🚙|suv;🚌|bus;🚎|trolleybus;🏎️|race car;🚓|police car;🚑|ambulance;🚒|fire engine;🚐|minibus;🛻|pickup truck;🚚|delivery truck;🚛|articulated lorry;🚜|tractor;🏍️|motorcycle;🛵|scooter;🚲|bicycle bike;🛴|kick scooter;🛹|skateboard;🛼|roller skate;🚂|locomotive train;🚆|train;🚇|metro subway;🚈|light rail;🚉|station;🚊|tram;🚝|monorail;🚞|mountain railway;🚋|tram car;🚃|railway car;🚄|high speed train;🚅|bullet train;✈️|airplane flight;🛫|departure plane;🛬|arrival plane;🛩️|small airplane;🚁|helicopter;🛸|flying saucer ufo;🚀|rocket space;🛰️|satellite;⛵|sailboat;🚤|speedboat;🛥️|motor boat;🛳️|passenger ship;⛴️|ferry;🚢|ship;⚓|anchor;🛟|life preserver;⛽|fuel gas station;🚧|construction barrier;🚦|traffic light;🚥|horizontal traffic light;🗺️|world map;🧭|compass;🗿|moai statue;🗽|statue liberty;🗼|tokyo tower;🏰|castle;🏯|japanese castle;🏟️|stadium;🎡|ferris wheel;🎢|roller coaster;🎠|carousel horse;⛲|fountain;⛱️|beach umbrella;🏖️|beach;🏝️|desert island;🏜️|desert;🏕️|camping;⛺|tent;🛖|hut;🏠|house;🏡|house garden;🏘️|houses neighborhood;🏚️|derelict house;🏗️|building construction;🏢|office building;🏬|department store;🏣|post office japan;🏤|post office;🏥|hospital;🏦|bank;🏨|hotel;🏪|convenience store;🏫|school;🏩|love hotel;💒|wedding chapel;🏛️|classical building;⛪|church;🕌|mosque;🕍|synagogue;🛕|hindu temple;🕋|kaaba;⛩️|shinto shrine;🛤️|railway track;🛣️|motorway road;🌁|foggy city;🌃|night stars city;🏙️|cityscape;🌆|city sunset;🌇|sunset;🌉|bridge night;🌌|galaxy;🌄|sunrise mountains;🌅|sunrise;🌠|shooting star;🎑|moon viewing;🏞️|national park;🌋|volcano;⛰️|mountain;🏔️|snow mountain;🗻|mount fuji;🏕️|camp tent`,
  Activities: `⚽|soccer football;🏀|basketball;🏈|american football;⚾|baseball;🥎|softball;🎾|tennis;🏐|volleyball;🏉|rugby;🥏|frisbee;🎱|pool billiards;🪀|yo yo;🏓|ping pong table tennis;🏸|badminton;🏒|ice hockey;🏑|field hockey;🥍|lacrosse;🏏|cricket;🪃|boomerang;🥅|goal net;⛳|golf flag;🪁|kite;🏹|bow arrow;🎣|fishing;🤿|diving mask;🥊|boxing glove;🥋|martial arts;🎽|running shirt;🛹|skateboard sport;🛷|sled;⛸️|ice skate;🥌|curling stone;🎿|skis;⛷️|skier;🏂|snowboarder;🪂|parachute;🏋️|weight lifter;🤼|wrestling;🤸|cartwheel gymnastics;⛹️|person bouncing ball;🤺|fencing;🤾|handball;🏌️|golf;🏇|horse racing;🧘|yoga meditation;🏄|surfing;🏊|swimming;🤽|water polo;🚣|rowing boat;🧗|climbing;🚴|cycling;🚵|mountain biking;🎖️|medal military;🏆|trophy winner;🥇|gold medal first;🥈|silver medal second;🥉|bronze medal third;🏅|sports medal;🎗️|reminder ribbon;🎫|ticket;🎟️|admission tickets;🎪|circus tent;🤹|juggling;🎭|performing arts theater;🩰|ballet shoes;🎨|art palette painting;🎬|clapper movie;🎤|microphone singing;🎧|headphones music;🎼|music score;🎹|piano keyboard;🥁|drum music;🪘|long drum;🎷|saxophone;🎺|trumpet;🪗|accordion;🎸|guitar;🪕|banjo;🎻|violin;🪈|flute;🎮|video game controller;🕹️|joystick game;🎲|dice;♟️|chess pawn;🧩|puzzle piece;🪅|pinata;🪩|disco ball;🎯|bullseye target;🎳|bowling;🎰|slot machine;🪄|magic wand;🧸|teddy bear toy;🪆|nesting dolls;🎉|party popper;🎊|confetti ball;🎈|balloon;🎏|carp streamer;🎀|ribbon bow;🎁|wrapped gift present;🎄|christmas tree;🎃|halloween pumpkin;🎆|fireworks;🎇|sparkler;🧨|firecracker;✨|sparkles;🪅|party pinata;🎐|wind chime;🎑|moon ceremony`,
  Objects: `⌚|watch time;📱|mobile phone;📲|phone arrow;💻|laptop computer;⌨️|keyboard;🖥️|desktop computer;🖨️|printer;🖱️|computer mouse;🖲️|trackball;💽|computer disk;💾|floppy disk save;💿|cd;📀|dvd;📼|videocassette;📷|camera photo;📸|camera flash;📹|video camera;🎥|movie camera;📽️|film projector;📞|telephone receiver;☎️|telephone;📟|pager;📠|fax machine;📺|television tv;📻|radio;🎙️|studio microphone;🎚️|level slider;🎛️|control knobs;🧭|compass;⏱️|stopwatch;⏲️|timer;⏰|alarm clock;🕰️|mantelpiece clock;⌛|hourglass;⏳|hourglass flowing;📡|satellite antenna;🔋|battery;🪫|low battery;🔌|electric plug;💡|light bulb idea;🔦|flashlight;🕯️|candle;🪔|oil lamp;🧯|fire extinguisher;🛢️|oil drum;💸|money flying;💵|dollar banknote;💴|yen banknote;💶|euro banknote;💷|pound banknote;🪙|coin;💰|money bag;💳|credit card;💎|gem diamond;⚖️|balance scale;🪜|ladder;🧰|toolbox;🪛|screwdriver;🔧|wrench spanner;🔨|hammer;⚒️|hammer pick;🛠️|hammer wrench tools;⛏️|pickaxe;🪚|saw;🔩|nut bolt;⚙️|gear;🪤|mouse trap;🧲|magnet;🔫|water pistol;💣|bomb;🪓|axe;🧱|brick;🔪|kitchen knife;🗡️|dagger;⚔️|crossed swords;🛡️|shield;🚬|cigarette;⚰️|coffin;🪦|headstone grave;⚱️|funeral urn;🏺|amphora;🔮|crystal ball;📿|prayer beads;🧿|evil eye;🪬|hamsa hand;💈|barber pole;⚗️|alembic;🔭|telescope;🔬|microscope;🕳️|hole;🩹|adhesive bandage;🩺|stethoscope;🩻|x ray;💊|pill medicine;💉|syringe;🧬|dna;🦠|microbe virus;🧫|petri dish;🧪|test tube;🌡️|thermometer;🧹|broom;🪠|plunger;🧺|basket;🧻|toilet paper;🚽|toilet;🚿|shower;🛁|bathtub;🧼|soap;🪥|toothbrush;🧽|sponge;🧴|lotion bottle;🛎️|bellhop bell;🔑|key;🗝️|old key;🚪|door;🪑|chair;🛋️|couch lamp;🛏️|bed;🪟|window;🪞|mirror;🪟|window pane;🧸|teddy bear;🖼️|framed picture;🛍️|shopping bags;🛒|shopping cart;🎒|backpack;🧳|luggage suitcase;👓|glasses;🕶️|sunglasses;🥽|goggles;🥼|lab coat;🦺|safety vest;👔|necktie;👕|t shirt;👖|jeans;🧣|scarf;🧤|gloves;🧥|coat;🧦|socks;👗|dress;👘|kimono;🥻|sari;🩱|one piece swimsuit;🩲|briefs;🩳|shorts;👙|bikini;👚|women clothes;🪭|folding fan;👛|purse;👜|handbag;👝|clutch;💼|briefcase;🪮|hair pick;🪒|razor;🧢|baseball cap;👒|hat;🎩|top hat;🎓|graduation cap;⛑️|rescue helmet;🪖|military helmet;👑|crown;💍|ring;🌂|closed umbrella;☂️|umbrella`,
  Symbols: `❤️|red heart love;🩷|pink heart;🧡|orange heart;💛|yellow heart;💚|green heart;💙|blue heart;🩵|light blue heart;💜|purple heart;🤎|brown heart;🖤|black heart;🩶|grey heart;🤍|white heart;💔|broken heart;❤️‍🔥|heart on fire;❤️‍🩹|mending heart;💕|two hearts;💞|revolving hearts;💓|beating heart;💗|growing heart;💖|sparkling heart;💘|heart arrow;💝|heart ribbon gift;💟|heart decoration;♥️|heart suit;❣️|heart exclamation;💌|love letter;💋|kiss mark;💯|hundred points;💢|anger symbol;💥|collision boom;💫|dizzy;💦|sweat droplets;💨|dash;🕳️|hole;💬|speech balloon;👁️‍🗨️|eye speech bubble;🗨️|left speech bubble;🗯️|anger bubble;💭|thought bubble;💤|sleep zzz;♠️|spade card suit;♣️|club card suit;♥️|heart card suit;♦️|diamond card suit;🃏|joker card;🎴|flower cards;🔇|muted speaker;🔈|low volume;🔉|medium volume;🔊|high volume;📢|loudspeaker;📣|megaphone;🔔|bell notification;🔕|bell muted;🎵|music note;🎶|musical notes;➕|plus;➖|minus;➗|divide;✖️|multiply;🟰|equals;♾️|infinity;‼️|double exclamation;⁉️|question exclamation;❓|question mark;❔|white question mark;❕|white exclamation;❗|exclamation mark;〰️|wavy dash;💱|currency exchange;💲|dollar sign;⚕️|medical symbol;♻️|recycle;⚜️|fleur de lis;🔱|trident;📛|name badge;🔰|beginner;⭕|hollow red circle;✅|check mark;☑️|check box;✔️|heavy check mark;❌|cross mark;❎|cross button;➰|curly loop;➿|double curly loop;〽️|part alternation;✳️|eight spoked asterisk;✴️|eight pointed star;❇️|sparkle;©️|copyright;®️|registered;™️|trademark;#️⃣|number sign;*️⃣|asterisk keycap;0️⃣|zero;1️⃣|one;2️⃣|two;3️⃣|three;4️⃣|four;5️⃣|five;6️⃣|six;7️⃣|seven;8️⃣|eight;9️⃣|nine;🔟|ten;🔠|uppercase letters;🔡|lowercase letters;🔢|numbers;🔣|symbols input;🔤|letters;🅰️|a button;🆎|ab button;🅱️|b button;🆑|clear button;🆒|cool button;🆓|free button;ℹ️|information;🆔|id button;Ⓜ️|metro;🆕|new button;🆖|ng button;🅾️|o button;🆗|ok button;🅿️|parking;🆘|sos help;🆙|up button;🆚|versus;🈁|japanese here;🈂️|japanese service charge;🈷️|japanese monthly amount;🈶|japanese not free;🈯|japanese reserved;🉐|japanese bargain;㊙️|japanese secret;㊗️|japanese congratulations;🈴|japanese passing grade;🈵|japanese full;🔴|red circle;🟠|orange circle;🟡|yellow circle;🟢|green circle;🔵|blue circle;🟣|purple circle;🟤|brown circle;⚫|black circle;⚪|white circle;🟥|red square;🟧|orange square;🟨|yellow square;🟩|green square;🟦|blue square;🟪|purple square;🟫|brown square;⬛|black large square;⬜|white large square;◼️|black medium square;◻️|white medium square;🔶|large orange diamond;🔷|large blue diamond;🔸|small orange diamond;🔹|small blue diamond;🔺|red triangle up;🔻|red triangle down;🔘|radio button;🔳|white square button;🔲|black square button;▪️|black small square;▫️|white small square;🔺|up triangle;🔻|down triangle;💠|diamond flower;🔆|bright button;🔅|dim button;⚛️|atom;🕉️|om;✡️|star of david;☸️|wheel dharma;☯️|yin yang;✝️|latin cross;☦️|orthodox cross;☪️|star crescent;☮️|peace symbol;🛐|place worship;♈|aries;♉|taurus;♊|gemini;♋|cancer;♌|leo;♍|virgo;♎|libra;♏|scorpio;♐|sagittarius;♑|capricorn;♒|aquarius;♓|pisces;⛎|ophiuchus;🔯|six pointed star;🪯|khanda;🔞|no under eighteen;🚫|prohibited;🚭|no smoking;🚯|no littering;🚱|non potable water;🚷|no pedestrians;📵|no mobile phones;🔞|age restriction;☢️|radioactive;☣️|biohazard;🚸|children crossing;🔃|clockwise arrows;🔄|counterclockwise arrows;🔁|repeat;🔂|repeat single;▶️|play;⏸️|pause;⏹️|stop;⏺️|record;⏭️|next track;⏮️|previous track;⏩|fast forward;⏪|rewind;🔀|shuffle tracks;🔼|up button;🔽|down button;⏫|fast up;⏬|fast down;⏏️|eject button;🔅|dim;🔆|bright;🔙|back;🔚|end;🔛|on;🔜|soon;🔝|top;⬆️|up arrow;⬇️|down arrow;⬅️|left arrow;➡️|right arrow;↗️|up right arrow;↘️|down right arrow;↙️|down left arrow;↖️|up left arrow;↕️|up down arrow;↔️|left right arrow;↩️|return arrow;↪️|right arrow hook;⤴️|arrow curve up;⤵️|arrow curve down;🔃|clockwise vertical arrows;🔄|refresh reload;🔁|repeat button;🔂|repeat one;`,
};

CATEGORY_DATA["Gesture & Hands"] = `🫶|heart hands love;🤲|palms up;👐|open hands;🙌|hands celebration;👏|clap applause;🤝|handshake deal;👍|thumbs up like yes;👎|thumbs down dislike no;👊|fist bump punch;✊|raised fist;🤛|left fist bump;🤜|right fist bump;🤞|fingers crossed luck;✌️|peace victory;🫰|finger heart;🤟|love you hand;🤘|rock on;👌|ok perfect;🤌|pinched fingers;🤏|pinching small;🫳|palm down;🫴|palm up;☝️|index up;👇|point down;👆|point up;👉|point right;👈|point left;✋|raised hand stop;🤚|back hand;🖐️|hand fingers spread;🖖|vulcan salute;👋|wave hello goodbye;🤙|call me;💪|flex strong;🦾|mechanical arm;🖕|middle finger;✍️|writing hand;🙏|pray thanks please;💅|nail polish;🤳|selfie`;
CATEGORY_DATA["Activity & Sports"] = `${CATEGORY_DATA.Activities || ""};⚽|soccer football;🏀|basketball;🏈|american football;⚾|baseball;🥎|softball;🎾|tennis;🏐|volleyball;🏉|rugby;🥏|frisbee;🎱|billiards pool;🪀|yo-yo;🏓|table tennis ping pong;🏸|badminton;🏒|ice hockey;🏑|field hockey;🥍|lacrosse;🏏|cricket;🪃|boomerang;🥅|goal net;⛳|golf;🪁|kite;🏹|archery bow;🎣|fishing;🤿|diving;🥊|boxing;🥋|martial arts;🎽|running shirt;🛹|skateboard;🛼|roller skate;🛷|sled;⛸️|ice skate;🥌|curling;🎿|ski;⛷️|skier;🏂|snowboard;🪂|parachute;🏋️|weight lifting;🤼|wrestling;🤸|gymnastics;⛹️|basketball player;🤺|fencing;🤾|handball;🏌️|golfer;🏇|horse racing;🧘|yoga;🏄|surfing;🏊|swimming;🤽|water polo;🚣|rowing;🧗|climbing;🚴|cycling;🚵|mountain biking;🏆|trophy;🥇|gold medal;🥈|silver medal;🥉|bronze medal;🏅|sports medal;🎖️|military medal;🏵️|rosette;🎗️|reminder ribbon;🎫|ticket;🎟️|admission ticket;🎪|circus`;
CATEGORY_DATA["Symbols & Flags"] = `${CATEGORY_DATA.Symbols || ""};🏁|checkered flag race;🚩|triangular flag;🎌|crossed flags;🏴|black flag;🏳️|white flag;🏳️‍🌈|rainbow flag pride;🏳️‍⚧️|transgender flag;🇺🇸|United States flag;🇬🇧|United Kingdom flag;🇨🇦|Canada flag;🇦🇺|Australia flag;🇮🇳|India flag;🇯🇵|Japan flag;🇫🇷|France flag;🇩🇪|Germany flag;🇮🇹|Italy flag;🇧🇷|Brazil flag;🇰🇷|South Korea flag;🇨🇳|China flag;🇲🇽|Mexico flag;🇿🇦|South Africa flag;🇳🇬|Nigeria flag;🇹🇷|Turkey flag;🇪🇸|Spain flag;🇸🇬|Singapore flag;🇵🇰|Pakistan flag;🇱🇰|Sri Lanka flag;🇳🇿|New Zealand flag;🇦🇪|United Arab Emirates flag;🇸🇪|Sweden flag;🇳🇴|Norway flag;🇫🇮|Finland flag;🇮🇪|Ireland flag;🇺🇦|Ukraine flag;🇵🇸|Palestine flag;🇺🇳|United Nations flag`;
delete CATEGORY_DATA.Activities;
delete CATEGORY_DATA.Symbols;

const CATEGORY_NAMES = Object.keys(CATEGORY_DATA) as EmojiCategory[];
const RECENT_STORAGE_KEY = "genie.whatsappEmojiPicker.recent";
const MAX_RECENTS = 24;

const EMOJI_CATALOG: EmojiEntry[] = CATEGORY_NAMES.flatMap((category) =>
  CATEGORY_DATA[category]
    .split(";")
    .filter(Boolean)
    .map((item) => {
      const [emoji, keywords = ""] = item.split("|");
      return { emoji, keywords: `${keywords} ${category}`.toLocaleLowerCase(), category };
    }),
);

function readRecentEmojis(): string[] {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(RECENT_STORAGE_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter((emoji): emoji is string => typeof emoji === "string").slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

export interface WhatsAppEmojiPickerProps {
  onSelect: (emoji: string) => void;
  className?: string;
  ariaLabel?: string;
  triggerIcon?: "smile" | "plus";
}

export default function WhatsAppEmojiPicker({
  onSelect,
  className = "",
  ariaLabel = "Choose emoji",
  triggerIcon = "smile",
}: WhatsAppEmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState("Recent");
  const [query, setQuery] = useState("");
  const [recentEmojis, setRecentEmojis] = useState<string[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRecentEmojis(readRecentEmojis());
  }, []);

  useEffect(() => {
    const close = () => {
      setOpen(false);
      setQuery("");
    };
    window.addEventListener("genie:close-composer-popovers", close);
    return () => window.removeEventListener("genie:close-composer-popovers", close);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("keydown", onKeyDown);
    searchRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const visibleEmojis = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    let entries: EmojiEntry[];
    if (normalizedQuery) {
      entries = EMOJI_CATALOG;
    } else if (activeCategory === "Recent") {
      entries = recentEmojis.flatMap((emoji) => {
        const entry = EMOJI_CATALOG.find((candidate) => candidate.emoji === emoji);
        return entry ? [entry] : [];
      });
    } else {
      entries = EMOJI_CATALOG.filter((entry) => entry.category === activeCategory);
    }
    if (!normalizedQuery) return entries;
    return entries.filter((entry) => `${entry.emoji} ${entry.keywords}`.includes(normalizedQuery));
  }, [activeCategory, query, recentEmojis]);

  function selectEmoji(emoji: string) {
    const nextRecent = [emoji, ...recentEmojis.filter((recent) => recent !== emoji)].slice(0, MAX_RECENTS);
    setRecentEmojis(nextRecent);
    try {
      window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(nextRecent));
    } catch {
      // The picker remains usable when storage is unavailable.
    }
    onSelect(emoji);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className={`relative inline-flex ${className}`.trim()}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={ariaLabel}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {triggerIcon === "plus"
          ? <Plus aria-hidden="true" size={18} />
          : <Smile aria-hidden="true" size={18} />}
      </button>
      {open && (
        <section
          aria-label="Emoji picker"
          className="absolute bottom-full right-0 z-50 mb-2 flex w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white p-3 text-gray-800 shadow-xl"
          onClick={(event) => event.stopPropagation()}
          role="dialog"
        >
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-gray-200 px-2">
            <Search aria-hidden="true" className="shrink-0 text-gray-400" size={16} />
            <input
              ref={searchRef}
              aria-label="Search emojis"
              className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none"
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search emojis by name or keyword..."
              type="search"
              value={query}
            />
            <button
              aria-label="Close emoji picker"
              className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-gray-100"
              onClick={() => { setOpen(false); setQuery(""); }}
              type="button"
            >
              <X aria-hidden="true" size={15} />
            </button>
          </div>
          <div aria-label="Emoji categories" className="mb-2 flex gap-1 overflow-x-auto pb-1" role="tablist">
            {["Recent", ...CATEGORY_NAMES].map((category) => (
              <button
                aria-selected={activeCategory === category}
                aria-controls="emoji-picker-panel"
                className={`shrink-0 rounded-md px-2 py-1 text-xs ${activeCategory === category ? "bg-gray-200 font-semibold" : "hover:bg-gray-100"}`}
                id={`emoji-tab-${category.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                key={category}
                onClick={() => setActiveCategory(category)}
                role="tab"
                type="button"
              >
                {category === "Recent" ? "Recently Used" : category}
              </button>
            ))}
          </div>
          <div
            aria-label={`${activeCategory} emojis`}
            className="grid max-h-56 grid-cols-8 gap-1 overflow-y-auto"
            id="emoji-picker-panel"
            role="tabpanel"
            aria-labelledby={`emoji-tab-${activeCategory.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
          >
            {visibleEmojis.map((entry, index) => (
              <button
                aria-label={`${entry.emoji} ${entry.keywords.split(" ")[0] ?? "emoji"}`}
                className="flex h-9 w-9 items-center justify-center rounded-md text-xl hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
                key={`${entry.emoji}-${index}`}
                onClick={() => selectEmoji(entry.emoji)}
                title={entry.keywords}
                type="button"
              >
                {entry.emoji}
              </button>
            ))}
            {!visibleEmojis.length && (
              <p className="col-span-8 py-6 text-center text-sm text-gray-500">No emojis found</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
