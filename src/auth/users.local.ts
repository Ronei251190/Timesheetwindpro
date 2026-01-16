// src/auth/users.local.ts
// WindPro Timesheet - USERS (login)
// Email = username | Password = code

export const USERS: Record<string, string> = {
  // === WINDPRO (corporate) ===
  "th@windpro.pl": "WINDPRO-ADMIN", // Tomasz Hynda (Owner/Admin)
  "rorog@windpro.pl": "WINDPRO-1002",
  "sebor@windpro.pl": "WINDPRO-1003",
  "kajus@windpro.pl": "WINDPRO-1004",
  "krshy@windpro.pl": "WINDPRO-1005",
  "marbl@windpro.pl": "WINDPRO-1006",
  "pazie@windpro.pl": "WINDPRO-1007",
  "rmsbn@windpro.pl": "WINDPRO-1008",
  "tokzz@windpro.pl": "WINDPRO-1009",
  "knima@windpro.pl": "WINDPRO-1010",
  "mamat@windpro.pl": "WINDPRO-1011", // Marcin Matysiak
  "shnor@windpro.pl": "WINDPRO-1012", // Shane
  "minis@windpro.pl": "WINDPRO-1013",
  "adapa@windpro.pl": "WINDPRO-1014",
  "pizin@windpro.pl": "WINDPRO-1015", // Piotr Zielinski
  "kajzd@windpro.pl": "WINDPRO-1016",
  "jagub@windpro.pl": "WINDPRO-1017", // Jakub Guba
  "stvor@windpro.pl": "WINDPRO-1018", // Steve
  "madzo@windpro.pl": "WINDPRO-1019", // Mateusz Dziemianko
  "pamge@windpro.pl": "WINDPRO-1020", // Pawel Magierowski
  "sensl@windpro.pl": "WINDPRO-1021", // Seweryn Slowik
  "ptrks@windpro.pl": "WINDPRO-1022", // Patryk Kostrzewa
  "rbmsz@windpro.pl": "WINDPRO-1023",
  "jawnk@windpro.pl": "WINDPRO-1024", // Jakub Wnuk
  "rbnaz@windpro.pl": "WINDPRO-1025",
  "rakla@windpro.pl": "WINDPRO-1026", // Rafal
  "pappl@windpro.pl": "WINDPRO-1027",
  "rajje@windpro.pl": "WINDPRO-1028",
  "mrzgo@windpro.pl": "WINDPRO-1029", // Mariusz
  "mimik@windpro.pl": "WINDPRO-1030", // Maciej Mikolajek
  "kokul@windpro.pl": "WINDPRO-1031", // Konrad Kulig
  "mirad@windpro.pl": "WINDPRO-1032", // Michal Radosz

  // === EXTERN / PRIVATE EMAILS ===
  "jasont071173@gmail.com": "WINDPRO-2001",
  "vais78@yahoo.com": "WINDPRO-2002",
  "ruslanspavlovs@outlook.com": "WINDPRO-2003",
  "kpax228@gmail.com": "WINDPRO-2004",
  "d.cerankowski@gmail.com": "WINDPRO-2005",
  "solraf@wp.pl": "WINDPRO-2006",
  "jacekpudlinski@gmail.com": "WINDPRO-2007",
  "wojtek.szypryt@gmail.com": "WINDPRO-2008",
  "rs.karol.zdrojewski@gmail.com": "WINDPRO-2009",
  "jakubguba86@gmail.com": "WINDPRO-2010",
  "mateusz.hankus1@gmail.com": "WINDPRO-2011",
  "scottjaredsmith79@gmail.com": "WINDPRO-2012",
  "c.mccormick21@yahoo.co.uk": "WINDPRO-2013",
  "bercia.bercia@gmail.com": "WINDPRO-2014",
  "michal.czerw@gmail.com": "WINDPRO-2015",
  "piotr_tomczak@yahoo.co.uk": "WINDPRO-2016",
  "pzwind@o2.pl": "WINDPRO-2017",
  "nistormihai02@gmail.com": "WINDPRO-2018",
  "t.brzyski91@gmail.com": "WINDPRO-2019",
  "norbi1322@gmail.com": "WINDPRO-2020",
  "krz.services66@gmail.com": "WINDPRO-2021",
  "shanen7913@gmail.com": "WINDPRO-2022",
  "pazdykalukasz@gmail.com": "WINDPRO-2023",
  "michalgrub@gmail.com": "WINDPRO-2024",
  "irek102086@wp.pl": "WINDPRO-2025",
  "marcin_pawlik_94@op.pl": "WINDPRO-2026",
  "kamilkowalinski@gmail.com": "WINDPRO-2027",
  "calin_marin_vasile@yahoo.com": "WINDPRO-2028",
  "matys99@wp.pl": "WINDPRO-2029",
  "adam.panek89@gmail.com": "WINDPRO-2030",
  "ptgr84@outlook.com": "WINDPRO-2031",
  "adrstl26@gmail.com": "WINDPRO-2032",
  "radek.luzny@gmail.com": "WINDPRO-2033",
  "martino22@o2.pl": "WINDPRO-2034",
  "artur_wojna@wp.pl": "WINDPRO-2035",
  "wyzlickamil@tlen.pl": "WINDPRO-2036",
  "mabdsoch@gmail.com": "WINDPRO-2037",
  "jacek92610@wp.pl": "WINDPRO-2038",
  "reloop21@wp.pl": "WINDPRO-2039",
  "g.cieniuch@wp.pl": "WINDPRO-2040",
  "m.cichosz1991@gmail.com": "WINDPRO-2041",
  "pamag@magawind.com": "WINDPRO-2042",
  "m.jablonski010@gmail.com": "WINDPRO-2043",

  // === YOU (employee) ===
  "bogdan.bitzy@yahoo.com": "WINDPRO-2044",
};

// IMPORTANT: allow any domain (gmail/wp/o2/yahoo ok)
export const ALLOWED_DOMAIN = "";
