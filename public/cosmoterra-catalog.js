(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.COSMOTERRA_CATALOG = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LEFT_Y = [
    682.51, 669.4, 656.29, 643.18, 630.07, 616.96, 603.84, 590.73, 577.62, 564.51,
    551.4, 538.29, 525.17, 512.06, 498.95, 485.84, 472.73, 459.62, 446.5, 433.39,
    420.28, 407.17, 394.06, 380.95, 367.83, 354.72, 341.61, 328.5, 315.39, 302.28,
    289.17, 276.05, 262.94, 249.83, 236.72, 223.61, 210.5, 197.38, 184.27, 171.16,
    158.05, 144.94, 131.83, 118.71, 105.6, 92.49, 79.38, 66.27, 53.16, 40.04
  ];

  const RIGHT_Y = [
    682.51, 669.4, 656.29, 643.18, 630.07, 616.96, 603.84, 590.73, 577.62, 564.51,
    551.4, 538.29, 525.17, 512.06, 498.95, 485.84, 472.73, 459.62, 446.5, 433.39,
    420.28, 407.17, 394.06, 380.95, 367.83, 354.72, 341.61, 328.5, 315.39, 302.04,
    288.69, 275.34, 262.23, 249.12, 236.01, 222.9, 209.79, 196.67, 183.56, 170.45,
    157.34, 144.93, 131.6, 118.56, 105.52, 92.34, 79.16, 65.98, 52.94, 39.94
  ];

  const MANUAL_ROW_INDICES = [41, 42, 43, 44, 45, 46, 47];
  const GIFT_FOOTER_ROW_INDEX = 48;
  const TOTAL_ROW_INDEX = 49;

  const LEFT_PRODUCTS = [
    { side: 'left', rowIndex: 0, nr: '130280', name: 'ACEROLA PLUS Kautabletten', ust: '10%', price: 27.5, wertmarken: 1 },
    { side: 'left', rowIndex: 1, nr: '100160', name: 'ALLERGO-STOP Kps.', ust: '10%', price: 31, wertmarken: 2 },
    { side: 'left', rowIndex: 2, nr: '250850', name: 'ALOE VERA Gel', ust: '20%', price: 22, wertmarken: 1 },
    { side: 'left', rowIndex: 3, nr: '140800', name: 'ALOE VERA Saft', ust: '10%', price: 31, wertmarken: 2 },
    { side: 'left', rowIndex: 4, nr: '400800', name: 'ALOE VERA Saft 3er-Pack', ust: '10%', price: 87, wertmarken: 5 },
    { side: 'left', rowIndex: 5, nr: '100120', name: 'ANTIOXIDANTIEN Kps.', ust: '10%', price: 40, wertmarken: 2 },
    { side: 'left', rowIndex: 6, nr: '100150', name: 'ANTISTRESS Plv.', ust: '10%', price: 45, wertmarken: 2 },
    { side: 'left', rowIndex: 7, nr: '150240', name: 'ARGININ PLUS Kps.', ust: '10%', price: 50, wertmarken: 3 },
    { side: 'left', rowIndex: 8, nr: '110318', name: 'ARTISCHOCKEN PLUS Kps.', ust: '10%', price: 44, wertmarken: 2 },
    { side: 'left', rowIndex: 9, nr: '130612', name: 'B-KOMPLEX PLUS Kps.', ust: '10%', price: 49, wertmarken: 3 },
    { side: 'left', rowIndex: 10, nr: '100416', name: 'BASENFIT Bad', ust: '20%', price: 32, wertmarken: 2 },
    { side: 'left', rowIndex: 11, nr: '100240', name: 'BASENFIT Kps.', ust: '10%', price: 35, wertmarken: 2 },
    { side: 'left', rowIndex: 12, nr: '100480', name: 'BASENFIT Plv.', ust: '10%', price: 56, wertmarken: 3 },
    { side: 'left', rowIndex: 13, nr: '250218', name: 'BEIN- UND FUSS-SPRAY', ust: '20%', price: 18, wertmarken: 1 },
    { side: 'left', rowIndex: 14, nr: '100370', name: 'BITTER PLUS Kps.', ust: '10%', price: 44, wertmarken: 2 },
    { side: 'left', rowIndex: 15, nr: '190151', name: 'BODY BASIC ENERGIE Plv.', ust: '10%', price: 43, wertmarken: 2 },
    { side: 'left', rowIndex: 16, nr: '190152', name: 'BODY BASIC ENERGIE Kps.', ust: '10%', price: 40.5, wertmarken: 2 },
    { side: 'left', rowIndex: 17, nr: '100131', name: 'BODY BASIC IMMUN Plv.', ust: '10%', price: 49.5, wertmarken: 3 },
    { side: 'left', rowIndex: 18, nr: '100132', name: 'BODY BASIC IMMUN Kps.', ust: '10%', price: 47, wertmarken: 3 },
    { side: 'left', rowIndex: 19, nr: '100151', name: 'BODY BASIC OMEGA+ Saft', ust: '10%', price: 39.5, wertmarken: 2 },
    { side: 'left', rowIndex: 20, nr: '100140', name: 'BODY BASIC REGENERATION Plv.', ust: '10%', price: 45, wertmarken: 2 },
    { side: 'left', rowIndex: 21, nr: '100141', name: 'BODY BASIC REGENERATION Kps.', ust: '10%', price: 37, wertmarken: 2 },
    { side: 'left', rowIndex: 22, nr: '251120', name: 'BUCHW. ROSSKASTANIEN Gel', ust: '20%', price: 29, wertmarken: 2 },
    { side: 'left', rowIndex: 23, nr: '252010', name: 'CISTROSA CREME', ust: '20%', price: 26, wertmarken: 1 },
    { side: 'left', rowIndex: 24, nr: '250700', name: 'CISTROSA LIPPENPFLEGE', ust: '20%', price: 7, wertmarken: 0 },
    { side: 'left', rowIndex: 25, nr: '370105', name: 'CISTROSA LIQUID', ust: '20%', price: 22, wertmarken: 1 },
    { side: 'left', rowIndex: 26, nr: '252015', name: 'CISTROSA SHAMPOO', ust: '20%', price: 19, wertmarken: 1 },
    { side: 'left', rowIndex: 27, nr: '111212', name: 'COENZYM Q10 PLUS 120 Kps.', ust: '10%', price: 75, wertmarken: 4 },
    { side: 'left', rowIndex: 28, nr: '111220', name: 'COENZYM Q10 PLUS 225 Kps.', ust: '10%', price: 130, wertmarken: 5 },
    { side: 'left', rowIndex: 29, nr: '111330', name: 'CURCUMIN PLUS Kps.', ust: '10%', price: 51, wertmarken: 3 },
    { side: 'left', rowIndex: 30, nr: '130360', name: 'DENK AKTIV Saft', ust: '10%', price: 32, wertmarken: 2 },
    { side: 'left', rowIndex: 31, nr: '250640', name: 'ECTOSAN Sonnenschutz', ust: '20%', price: 35, wertmarken: 2 },
    { side: 'left', rowIndex: 32, nr: '250610', name: 'ECTOSAN Zellschutz', ust: '20%', price: 31, wertmarken: 2 },
    { side: 'left', rowIndex: 33, nr: '120500', name: 'FASZIEN-DETOX Kps.', ust: '10%', price: 41.5, wertmarken: 2 },
    { side: 'left', rowIndex: 34, nr: '120400', name: 'FASZIEN-DETOX Plv.', ust: '10%', price: 52, wertmarken: 3 },
    { side: 'left', rowIndex: 35, nr: '140350', name: 'FICHTENNADEL 250 ml', ust: '10%', price: 16.5, wertmarken: 1 },
    { side: 'left', rowIndex: 36, nr: '150150', name: 'FOLAT PLUS Kps.', ust: '10%', price: 30, wertmarken: 2 },
    { side: 'left', rowIndex: 37, nr: '160112', name: 'GELEE ROYALE PLUS Kps.', ust: '10%', price: 63, wertmarken: 3 },
    { side: 'left', rowIndex: 38, nr: '110518', name: 'GELENK AKTIV Kps.', ust: '10%', price: 61, wertmarken: 3 },
    { side: 'left', rowIndex: 39, nr: '110706', name: 'GLUCO STABIL 120 Kps.', ust: '10%', price: 51.5, wertmarken: 3 },
    { side: 'left', rowIndex: 40, nr: '100380', name: 'GLUTAMIN PLUS Plv.', ust: '10%', price: 62, wertmarken: 3 },
    { side: 'left', rowIndex: 41, nr: '120312', name: 'HAAR VITAL Kps.', ust: '10%', price: 39, wertmarken: 2 },
    { side: 'left', rowIndex: 42, nr: '250410', name: 'HANDCREME MIT SALBEI', ust: '20%', price: 13, wertmarken: 1 },
    { side: 'left', rowIndex: 43, nr: '250320', name: 'HOLZKNECHT BALSAM', ust: '20%', price: 34, wertmarken: 2 },
    { side: 'left', rowIndex: 44, nr: '140612', name: 'HOPFEN-HAFER PLUS Kps.', ust: '10%', price: 44, wertmarken: 2 },
    { side: 'left', rowIndex: 45, nr: '250507', name: 'HORNHAUT CREME', ust: '20%', price: 20, wertmarken: 1 },
    { side: 'left', rowIndex: 46, nr: '130350', name: 'KINDERFIT Saft', ust: '10%', price: 22, wertmarken: 1 },
    { side: 'left', rowIndex: 47, nr: '340212', name: 'KAKAO PLUS Plv.', ust: '10%', price: 29.5, wertmarken: 2, missingEq: true },
    { side: 'left', rowIndex: 48, nr: '100145', name: 'KOLLAGEN PLUS Plv.', ust: '10%', price: 54, wertmarken: 3, missingEq: true },
    { side: 'left', rowIndex: 49, nr: '140650', name: 'LEBENSKRAFT Elixier', ust: '20%', price: 21, wertmarken: 1 }
  ];

  const RIGHT_PRODUCTS = [
    { side: 'right', rowIndex: 0, nr: '130600', name: 'LECITHIN PLUS Plv.', ust: '10%', price: 59, wertmarken: 3 },
    { side: 'right', rowIndex: 1, nr: '120212', name: 'MAGNESIUM PLUS Kps.', ust: '10%', price: 38, wertmarken: 2 },
    { side: 'right', rowIndex: 2, nr: '110060', name: 'NADH PLUS Kps.', ust: '10%', price: 59, wertmarken: 3 },
    { side: 'right', rowIndex: 3, nr: '150120', name: 'NATURO Kps.', ust: '10%', price: 62, wertmarken: 3 },
    { side: 'right', rowIndex: 4, nr: '150061', name: 'OMEGA 3 PLUS 60 Kps.', ust: '10%', price: 52, wertmarken: 3 },
    { side: 'right', rowIndex: 5, nr: '150071', name: 'OMEGA 3 PLUS 120 Kps.', ust: '10%', price: 99, wertmarken: 5 },
    { side: 'right', rowIndex: 6, nr: '100350', name: 'OSSPURA Plv.', ust: '10%', price: 54, wertmarken: 3 },
    { side: 'right', rowIndex: 7, nr: '100450', name: 'OSSPURA MILD Plv.', ust: '10%', price: 53.5, wertmarken: 3 },
    { side: 'right', rowIndex: 8, nr: '100700', name: 'PANMOL® VITAL BOOST Plv.', ust: '10%', price: 39, wertmarken: 2 },
    { side: 'right', rowIndex: 9, nr: '190201', name: 'POWERSPORTS®RELOAD Dose', ust: '10%', price: 54, wertmarken: 3 },
    { side: 'right', rowIndex: 10, nr: '190251', name: 'POWERSPORTS® RELOAD Sachets', ust: '10%', price: 36, wertmarken: 2 },
    { side: 'right', rowIndex: 11, nr: '100390', name: 'PROBIO PLUS Kps.', ust: '10%', price: 89, wertmarken: 5 },
    { side: 'right', rowIndex: 12, nr: '180124', name: 'PROPOLIS PLUS Kps.', ust: '10%', price: 44, wertmarken: 2 },
    { side: 'right', rowIndex: 13, nr: '140225', name: 'QUENDEL Kräutersaft 250ml', ust: '10%', price: 15, wertmarken: 1 },
    { side: 'right', rowIndex: 14, nr: '170112', name: 'ROTKLEE PLUS Kps.', ust: '10%', price: 56, wertmarken: 3 },
    { side: 'right', rowIndex: 15, nr: '110620', name: 'SEHKRAFT Kps.', ust: '10%', price: 53.5, wertmarken: 3 },
    { side: 'right', rowIndex: 16, nr: '130112', name: 'SELEN PLUS Kps.', ust: '10%', price: 59.5, wertmarken: 3 },
    { side: 'right', rowIndex: 17, nr: '370110', name: 'SELEN PLUS Spray', ust: '10%', price: 24.5, wertmarken: 1 },
    { side: 'right', rowIndex: 18, nr: '120320', name: 'SENSITIV Kps.', ust: '10%', price: 32, wertmarken: 2 },
    { side: 'right', rowIndex: 19, nr: '130520', name: 'SONNENKRAFT Kps.', ust: '10%', price: 49.5, wertmarken: 3 },
    { side: 'right', rowIndex: 20, nr: '140512', name: 'STIMMUNGSPLUS Kps.', ust: '10%', price: 50, wertmarken: 3 },
    { side: 'right', rowIndex: 21, nr: '140120', name: 'VENEN AKTIV Kps.', ust: '10%', price: 41, wertmarken: 2 },
    { side: 'right', rowIndex: 22, nr: '160130', name: 'VITAMIN C PLUS Kps.', ust: '10%', price: 49, wertmarken: 3 },
    { side: 'right', rowIndex: 23, nr: '370120', name: 'VITAMIN D3 Tropfen', ust: '10%', price: 14, wertmarken: 1 },
    { side: 'right', rowIndex: 24, nr: '160220', name: 'VITAMIN E PLUS Kps.', ust: '10%', price: 62, wertmarken: 3 },
    { side: 'right', rowIndex: 25, nr: '370130', name: 'VITAMIN K2 Tropfen', ust: '10%', price: 49, wertmarken: 3 },
    { side: 'right', rowIndex: 26, nr: '250510', name: 'WEIHRAUCH CREME 100 ml', ust: '20%', price: 24, wertmarken: 1 },
    { side: 'right', rowIndex: 27, nr: '250520', name: 'WEIHRAUCH CREME 200 ml', ust: '20%', price: 42, wertmarken: 2 },
    { side: 'right', rowIndex: 28, nr: '250530', name: 'WEIHRAUCH CREME 500 ml', ust: '20%', price: 99, wertmarken: 5 },
    { side: 'right', rowIndex: 29, nr: '120240', name: 'WEIHRAUCH PLUS Kps.', ust: '10%', price: 42, wertmarken: 2 },
    { side: 'right', rowIndex: 30, nr: '170120', name: 'YAMSWURZEL PLUS Kps.', ust: '10%', price: 51.5, wertmarken: 3 },
    { side: 'right', rowIndex: 31, nr: '120180', name: 'ZINK PLUS 180 Kps.', ust: '10%', price: 46, wertmarken: 3 },
    // rowIndex 32 is the spacer row on the printed form
    { side: 'right', rowIndex: 33, nr: '400161', name: 'BASIS-Programm', ust: '10%', price: 140, wertmarken: 4 },
    { side: 'right', rowIndex: 34, nr: '400270', name: 'DARM-START-Programm', ust: '10%', price: 148, wertmarken: 5 },
    { side: 'right', rowIndex: 35, nr: '400250', name: 'DERMA-Programm', ust: '10%', price: 104, wertmarken: 4 },
    { side: 'right', rowIndex: 36, nr: '400230', name: 'IMMUN-Programm', ust: '10%', price: 168, wertmarken: 5 },
    { side: 'right', rowIndex: 37, nr: '400112', name: 'KNOCHEN/ GELENKE-Progr. MILD', ust: '10%', price: 146, wertmarken: 4 },
    { side: 'right', rowIndex: 38, nr: '400100', name: 'NERVEN/ STRESS-Programm', ust: '10%', price: 175, wertmarken: 5 },
    { side: 'right', rowIndex: 39, nr: '400290', name: 'SCHWANGERSCHAFTS-Programm', ust: '10%', price: 106, wertmarken: 4 },
    { side: 'right', rowIndex: 40, nr: '400260', name: 'VENEN-Programm', ust: '10+20%', price: 116, wertmarken: 4 }
  ];

  const WERTMARKEN_BY_NR = {
    '120330': 2,
    '340112': 1
  };
  for (const p of LEFT_PRODUCTS) WERTMARKEN_BY_NR[p.nr] = p.wertmarken;
  for (const p of RIGHT_PRODUCTS) WERTMARKEN_BY_NR[p.nr] = p.wertmarken;

  return {
    LEFT_Y,
    RIGHT_Y,
    MANUAL_ROW_INDICES,
    GIFT_FOOTER_ROW_INDEX,
    TOTAL_ROW_INDEX,
    LEFT_PRODUCTS,
    RIGHT_PRODUCTS,
    WERTMARKEN_BY_NR
  };
}));
