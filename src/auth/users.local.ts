// src/auth/users.local.ts
// Lista oficială de angajați WindPro care se pot loga în Timesheet

export const USERS: Record<string, string> = {
  // WINDPRO
  "th@windpro.pl": "WINDPRO-1001",            // Tomasz Hynda
  "pizin@windpro.pl": "WINDPRO-1002",         // Piotr Zielinski
  "minis@windpro.pl": "WINDPRO-1003",         // Minis Minis
  "adapa@windpro.pl": "WINDPRO-1004",         // Adapa
  "mamat@windpro.pl": "WINDPRO-1005",         // Marcin Matysiak
  "shnor@windpro.pl": "WINDPRO-1006",         // Shane Norris
  "borot@windpro.pl": "WINDPRO-1234",         // Bogdan Rotariu

  // EXTERN / PERSONAL
  "pzwind@o2.pl": "WINDPRO-2001",              // Piotr Zielinski (privat)
  "nistormihai02@gmail.com": "WINDPRO-2002",   // Nistor Mihai
  "t.brzyski91@gmail.com": "WINDPRO-2003",     // Tomasz Brzyski
  "norbi1322@gmail.com": "WINDPRO-2004",       // Norbert Żugaj
  "krz.services66@gmail.com": "WINDPRO-2005",  // Krzysztof Żugaj
  "shanen7913@gmail.com": "WINDPRO-2006",      // Shane Norris (privat)
  "pazdykalukasz@gmail.com": "WINDPRO-2007",   // Lukasz Pazdyka
  "michalgrub@gmail.com": "WINDPRO-2008",      // Michal Grubecki
  "irek102086@wp.pl": "WINDPRO-2009",          // Irek
  "marcin_pawlik_94@op.pl": "WINDPRO-2010",    // Marcin Pawlik
  "kamilkowalinski@gmail.com": "WINDPRO-2011", // Kamil Kowaliński
  "calin_marin_vasile@yahoo.com": "WINDPRO-2012", // Marin-Vasile Calin
  "matys99@wp.pl": "WINDPRO-2013",             // Marcin Matysiak (privat)
  "adam.panek89@gmail.com": "WINDPRO-2014",    // Adam Panek
  "bogdan.bitzy@yahoo.com": "WINDPRO-ADMIN",   // Bogdan Rotariu
};

// opțional – permiți doar emailuri windpro.pl (dacă vrei restricție)
export const ALLOWED_DOMAIN = "windpro.pl";
