/**
 * Deterministic plan engine.
 *
 * Every recommendation is derived from the current AQI and the user's profile,
 * and its impact string comes from the same exposure model the simulator uses.
 * The result is deliberately small (max 6 tips) and always covers routine,
 * indoor and sustainable actions when those apply.
 */

import { cookingPm25, estimateExposure, profileToScenario, weeklyCommuteCo2Kg } from './impact.js';
import { hasSensitiveGroups } from './profile.js';
import { t } from './i18n.js';

const CATEGORY_ORDER = ['routine', 'indoors', 'sustainable'];
const CATEGORY_LABELS = {
  routine: 'plan.category.routine',
  indoors: 'plan.category.indoors',
  sustainable: 'plan.category.sustainable',
};

export const EFFORT_LABELS = {
  low: 'plan.effort.low',
  med: 'plan.effort.med',
  high: 'plan.effort.high',
};

const pct = (value) => Math.max(0, Math.round(value));
const oneDecimal = (value) => Math.max(0, Math.round(value * 10) / 10);

function modeLabel(mode, lang) {
  return t(`profile.mode.${mode}`, lang);
}

/**
 * Localised text for each rule. Each function receives computed metrics so the
 * numbers in the copy are the same numbers the model produced.
 */
const RULE_TEXT = {
  mask: {
    en: (m) => ({
      action: 'Wear a fitted N95 outdoors and keep it on for the whole commute',
      why: 'The seal is what does the work: a well-fitted N95 filters about 95% of fine particles, so your commute dose drops sharply.',
      impact:
        m.cigs > 0
          ? `About 90% fewer particles on the commute — roughly ${m.cigs} fewer cigarette-equivalents a week.`
          : 'About 90% fewer particles on the commute while the mask is worn.',
      basis:
        'N95 ≈95% filtration (NIOSH); 22 µg/m³ 24-hour PM2.5 ≈ 1 cigarette/day; assumes a 1-hour daily commute at roadside concentrations.',
    }),
    hi: (m) => ({
      action: 'बाहर जाते समय ठीक से बैठने वाला N95 पहनें और पूरे सफ़र में लगाए रखें',
      why: 'असली फ़र्क़ सील का है: अच्छी तरह बैठा N95 लगभग 95% महीन कण रोकता है, जिससे सफ़र में आपका जोखिम तेज़ी से घटता है।',
      impact:
        m.cigs > 0
          ? `सफ़र में करीब 90% कम कण — हफ़्ते में लगभग ${m.cigs} कम सिगरेट-समान।`
          : 'मास्क पहने रहने पर सफ़र में करीब 90% कम कण।',
      basis:
        'N95 ≈95% फ़िल्टरेशन (NIOSH); 22 µg/m³ 24 घंटे का औसत ≈ 1 सिगरेट/दिन; रोज़ 1 घंटे का सफ़र, सड़क किनारे की सांद्रता।',
    }),
    kn: (m) => ({
      action: 'ಹೊರಗೆ ಹೋಗುವಾಗ ಸರಿಯಾಗಿ ಕೂರುವ N95 ಧರಿಸಿ, ಪ್ರಯಾಣದ ಉದ್ದಕ್ಕೂ ಧರಿಸಿರಿ',
      why: 'ಸರಿಯಾದ ಸೀಲ್ ಮುಖ್ಯ: ಚೆನ್ನಾಗಿ ಕೂರುವ N95 ಸುಮಾರು 95% ಸೂಕ್ಷ್ಮ ಕಣಗಳನ್ನು ತಡೆಯುತ್ತದೆ, ಹೀಗಾಗಿ ಪ್ರಯಾಣದ ಒಡ್ಡಿಕೆ ಬೇಗ ಇಳಿಯುತ್ತದೆ.',
      impact:
        m.cigs > 0
          ? `ಪ್ರಯಾಣದಲ್ಲಿ ಸುಮಾರು 90% ಕಡಿಮೆ ಕಣಗಳು — ವಾರಕ್ಕೆ ಸುಮಾರು ${m.cigs} ಕಡಿಮೆ ಸಿಗರೆಟ್ ಸಮಾನ.`
          : 'ಮಾಸ್ಕ್ ಧರಿಸಿದಾಗ ಪ್ರಯಾಣದಲ್ಲಿ ಸುಮಾರು 90% ಕಡಿಮೆ ಕಣಗಳು.',
      basis:
        'N95 ≈95% ಫಿಲ್ಟರೇಶನ್ (NIOSH); 22 µg/m³ 24 ಗಂಟೆ ಸರಾಸರಿ ≈ 1 ಸಿಗರೆಟ್/ದಿನ; ದಿನಕ್ಕೆ 1 ಗಂಟೆ ಪ್ರಯಾಣ, ರಸ್ತೆ ಬದಿಯ ಸಾಂದ್ರತೆ.',
    }),
  },
  metroSwap: {
    en: (m) => ({
      action: `Take the metro ${m.metroDays} days a week instead of the ${m.mode.toLowerCase()}`,
      why: 'Metro carriages are filtered and you avoid roadside traffic, so both your exposure and your emissions fall.',
      impact: `About ${m.pct}% less PM2.5 and roughly ${m.co2} kg CO₂ saved each week.`,
      basis:
        'Car 0.17, two-wheeler 0.05, bus 0.04 and metro 0.03 kg CO₂ per passenger-km; metro cabin PM2.5 estimated at 40% of roadside air.',
    }),
    hi: (m) => ({
      action: `हफ़्ते में ${m.metroDays} दिन ${m.mode.toLowerCase()} की जगह मेट्रो लें`,
      why: 'मेट्रो के डिब्बों में फ़िल्टर होता है और आप सड़क के ट्रैफ़िक से बचते हैं, इसलिए जोखिम और उत्सर्जन दोनों घटते हैं।',
      impact: `करीब ${m.pct}% कम PM2.5 और हर हफ़्ते लगभग ${m.co2} किग्रा CO₂ की बचत।`,
      basis:
        'कार 0.17, दोपहिया 0.05, बस 0.04 और मेट्रो 0.03 किग्रा CO₂ प्रति यात्री-किमी; मेट्रो के अंदर PM2.5 सड़क की हवा का 40% माना गया।',
    }),
    kn: (m) => ({
      action: `ವಾರಕ್ಕೆ ${m.metroDays} ದಿನ ${m.mode.toLowerCase()} ಬದಲು ಮೆಟ್ರೋ ಬಳಸಿ`,
      why: 'ಮೆಟ್ರೋ ಬೋಗಿಗಳಲ್ಲಿ ಫಿಲ್ಟರ್ ಇರುತ್ತದೆ ಮತ್ತು ರಸ್ತೆ ಸಂಚಾರ ತಪ್ಪುತ್ತದೆ, ಹೀಗಾಗಿ ಒಡ್ಡಿಕೆ ಮತ್ತು ಹೊರಸೂಸುವಿಕೆ ಎರಡೂ ಕಡಿಮೆಯಾಗುತ್ತವೆ.',
      impact: `ಸುಮಾರು ${m.pct}% ಕಡಿಮೆ PM2.5 ಮತ್ತು ವಾರಕ್ಕೆ ಸುಮಾರು ${m.co2} ಕಿ.ಗ್ರಾಂ CO₂ ಉಳಿತಾಯ.`,
      basis:
        'ಕಾರು 0.17, ದ್ವಿಚಕ್ರ 0.05, ಬಸ್ 0.04, ಮೆಟ್ರೋ 0.03 ಕಿ.ಗ್ರಾಂ CO₂ ಪ್ರತಿ ಪ್ರಯಾಣಿಕ-ಕಿ.ಮೀ; ಮೆಟ್ರೋ ಒಳಗಿನ PM2.5 ರಸ್ತೆ ಗಾಳಿಯ 40%.',
    }),
  },
  exerciseIndoor: {
    en: (m) => ({
      action: 'Move today’s workout indoors or to the cleanest hour',
      why: `Exercise multiplies the air you breathe by about 1.6×, and at AQI ${m.aqi} that matters more than the workout itself.`,
      impact: `About ${m.pct}% less PM2.5 on workout days.`,
      basis:
        'Moderate exercise ≈1.6 m³/h ventilation versus ≈0.55 m³/h at rest; indoor PM2.5 estimated from your home setup.',
    }),
    hi: (m) => ({
      action: 'आज का व्यायाम घर के अंदर या सबसे साफ़ घंटे में करें',
      why: `व्यायाम से साँस की मात्रा लगभग 1.6 गुना हो जाती है, और AQI ${m.aqi} पर यह कसरत से ज़्यादा मायने रखता है।`,
      impact: `व्यायाम वाले दिनों में करीब ${m.pct}% कम PM2.5।`,
      basis:
        'मध्यम व्यायाम ≈1.6 m³/घंटा वेंटिलेशन, आराम में ≈0.55 m³/घंटा; घर के अंदर की हवा आपकी घरेलू व्यवस्था से अनुमानित।',
    }),
    kn: (m) => ({
      action: 'ಇಂದಿನ ವ್ಯಾಯಾಮ ಒಳಗೆ ಅಥವಾ ಅತ್ಯಂತ ಸ್ವಚ್ಛ ಗಂಟೆಯಲ್ಲಿ ಮಾಡಿ',
      why: `ವ್ಯಾಯಾಮದಿಂದ ಉಸಿರಾಟ ಸುಮಾರು 1.6 ಪಟ್ಟು ಹೆಚ್ಚುತ್ತದೆ, AQI ${m.aqi} ನಲ್ಲಿ ಇದು ವ್ಯಾಯಾಮಕ್ಕಿಂತ ಹೆಚ್ಚು ಮುಖ್ಯ.`,
      impact: `ವ್ಯಾಯಾಮದ ದಿನಗಳಲ್ಲಿ ಸುಮಾರು ${m.pct}% ಕಡಿಮೆ PM2.5.`,
      basis:
        'ಮಧ್ಯಮ ವ್ಯಾಯಾಮ ≈1.6 m³/ಗಂಟೆ ವೆಂಟಿಲೇಶನ್, ವಿಶ್ರಾಂತಿಯಲ್ಲಿ ≈0.55 m³/ಗಂಟೆ; ಒಳಾಂಗಣ PM2.5 ನಿಮ್ಮ ಮನೆಯ ಸ್ಥಿತಿಯಿಂದ ಅಂದಾಜು.',
    }),
  },
  purifier: {
    en: (m) => ({
      action: 'Run a HEPA purifier in the room you use most, especially at night',
      why: 'With windows shut, a correctly sized HEPA unit typically removes 50–80% of indoor PM2.5.',
      impact: `About ${m.pct}% less PM2.5 over a full day.`,
      basis:
        'HEPA 50–80% indoor reduction (midpoint 65%), 10 hours a day, windows closed; sized for one room.',
    }),
    hi: (m) => ({
      action: 'जिस कमरे में सबसे ज़्यादा समय बिताते हैं, वहाँ HEPA प्यूरीफ़ायर चलाएँ — खासकर रात में',
      why: 'खिड़कियाँ बंद हों तो सही आकार का HEPA यंत्र आमतौर पर घर के अंदर का PM2.5 50–80% तक घटा देता है।',
      impact: `पूरे दिन में करीब ${m.pct}% कम PM2.5।`,
      basis: 'HEPA से 50–80% कमी (मध्य 65%), रोज़ 10 घंटे, खिड़कियाँ बंद, एक कमरे के लिए।',
    }),
    kn: (m) => ({
      action: 'ಹೆಚ್ಚು ಸಮಯ ಕಳೆಯುವ ಕೋಣೆಯಲ್ಲಿ HEPA ಪ್ಯೂರಿಫೈಯರ್ ಚಾಲನೆ ಮಾಡಿ — ರಾತ್ರಿ ಮುಖ್ಯ',
      why: 'ಕಿಟಕಿ ಮುಚ್ಚಿದ್ದರೆ ಸರಿಯಾದ ಗಾತ್ರದ HEPA ಘಟಕ ಸಾಮಾನ್ಯವಾಗಿ ಒಳಾಂಗಣ PM2.5 ಅನ್ನು 50–80% ಕಡಿಮೆ ಮಾಡುತ್ತದೆ.',
      impact: `ಇಡೀ ದಿನದಲ್ಲಿ ಸುಮಾರು ${m.pct}% ಕಡಿಮೆ PM2.5.`,
      basis: 'HEPA 50–80% ಕಡಿತ (ಮಧ್ಯ 65%), ದಿನಕ್ಕೆ 10 ಗಂಟೆ, ಕಿಟಕಿ ಮುಚ್ಚಿ, ಒಂದು ಕೋಣೆಗೆ.',
    }),
  },
  closeWindows: {
    en: (m) => ({
      action: 'Keep windows closed while outdoor air is at its worst',
      why: 'Open windows pull outdoor PM2.5 straight in; closing them during peak hours keeps indoor air closer to background.',
      impact: `About ${m.pct}% less PM2.5 today.`,
      basis: 'Infiltration estimated at 95% with windows open versus 72% closed.',
    }),
    hi: (m) => ({
      action: 'जब बाहर की हवा सबसे खराब हो, खिड़कियाँ बंद रखें',
      why: 'खुली खिड़कियाँ बाहर का PM2.5 सीधे अंदर लाती हैं; सबसे खराब घंटों में बंद रखने से घर की हवा कुछ बेहतर रहती है।',
      impact: `आज करीब ${m.pct}% कम PM2.5।`,
      basis: 'खिड़कियाँ खुली हों तो 95% और बंद हों तो 72% हवा अंदर आने का अनुमान।',
    }),
    kn: (m) => ({
      action: 'ಹೊರಗಿನ ಗಾಳಿ ಅತ್ಯಂತ ಕೆಟ್ಟಾಗಿರುವಾಗ ಕಿಟಕಿ ಮುಚ್ಚಿ',
      why: 'ತೆರೆದ ಕಿಟಕಿ ಹೊರಗಿನ PM2.5 ನೇರವಾಗಿ ಒಳಗೆ ತರುತ್ತದೆ; ಕೆಟ್ಟ ಗಂಟೆಗಳಲ್ಲಿ ಮುಚ್ಚಿದರೆ ಒಳಗಿನ ಗಾಳಿ ಸ್ವಲ್ಪ ಉತ್ತಮವಿರುತ್ತದೆ.',
      impact: `ಇಂದು ಸುಮಾರು ${m.pct}% ಕಡಿಮೆ PM2.5.`,
      basis: 'ಕಿಟಕಿ ತೆರೆದಿದ್ದರೆ 95%, ಮುಚ್ಚಿದ್ದರೆ 72% ಒಳಬರುವಿಕೆ ಎಂದು ಅಂದಾಜು.',
    }),
  },
  fuel: {
    en: (m) => ({
      action: 'Cook on LPG or induction rather than wood, coal or kerosene',
      why: 'Solid-fuel smoke is the largest indoor PM2.5 source in many Indian homes — often worse than the air outside.',
      impact: `About ${m.pct}% less PM2.5 from cooking indoors.`,
      basis:
        'Cooking surge ≈90 µg/m³ for biomass, 45 for kerosene, 12 for LPG over 1.5 hours; first-order estimate.',
    }),
    hi: (m) => ({
      action: 'लकड़ी, कोयला या मिट्टी के तेल की जगह LPG या इंडक्शन पर खाना पकाएँ',
      why: 'कई भारतीय घरों में ठोस ईंधन का धुआँ घर के PM2.5 का सबसे बड़ा स्रोत है — अक्सर बाहर की हवा से भी खराब।',
      impact: `खाना पकाने से होने वाला घर का PM2.5 करीब ${m.pct}% कम।`,
      basis:
        '1.5 घंटे में बायोमास ≈90 µg/m³, मिट्टी का तेल 45, LPG 12 का अतिरिक्त PM2.5; प्रथम-स्तरीय अनुमान।',
    }),
    kn: (m) => ({
      action: 'ಕಟ್ಟಿಗೆ, ಕಲ್ಲಿದ್ದಲು ಅಥವಾ ಸೀಮೆಎಣ್ಣೆ ಬದಲು LPG ಅಥವಾ ಇಂಡಕ್ಷನ್‌ನಲ್ಲಿ ಅಡುಗೆ ಮಾಡಿ',
      why: 'ಅನೇಕ ಭಾರತೀಯ ಮನೆಗಳಲ್ಲಿ ಘನ ಇಂಧನದ ಹೊಗೆ ಒಳಾಂಗಣ PM2.5 ನ ದೊಡ್ಡ ಮೂಲ — ಹೊರಗಿನ ಗಾಳಿಗಿಂತ ಕೆಟ್ಟದಾಗಿರುತ್ತದೆ.',
      impact: `ಅಡುಗೆಯಿಂದ ಒಳಗೆ ಉಂಟಾಗುವ PM2.5 ಸುಮಾರು ${m.pct}% ಕಡಿಮೆ.`,
      basis: '1.5 ಗಂಟೆಯಲ್ಲಿ ಬಯೋಮಾಸ್ ≈90 µg/m³, ಸೀಮೆಎಣ್ಣೆ 45, LPG 12 ಹೆಚ್ಚುವರಿ PM2.5; ಪ್ರಥಮ ಹಂತದ ಅಂದಾಜು.',
    }),
  },
  sensitive: {
    en: (m) => ({
      action: 'Keep children, older adults and anyone with asthma in the cleanest room today',
      why: 'Their lungs take in more particles for the same air, and symptoms can start at lower concentrations.',
      impact: `About ${m.pct}% lower exposure for them with windows shut and the purifier on.`,
      basis: 'Closed windows plus a HEPA purifier for 12 hours; guidance follows CPCB health advisories.',
    }),
    hi: (m) => ({
      action: 'आज बच्चों, बुज़ुर्गों और अस्थमा वालों को सबसे साफ़ कमरे में रखें',
      why: 'एक ही हवा में उनके फेफड़े ज़्यादा कण लेते हैं, और लक्षण कम सांद्रता पर भी शुरू हो सकते हैं।',
      impact: `खिड़कियाँ बंद और प्यूरीफ़ायर चालू रखने पर उनका जोखिम करीब ${m.pct}% कम।`,
      basis: '12 घंटे बंद खिड़कियाँ और HEPA; सलाह CPCB स्वास्थ्य परामर्श के अनुरूप।',
    }),
    kn: (m) => ({
      action: 'ಇಂದು ಮಕ್ಕಳು, ಹಿರಿಯರು ಮತ್ತು ಆಸ್ತಮಾ ಇರುವವರನ್ನು ಅತ್ಯಂತ ಸ್ವಚ್ಛ ಕೋಣೆಯಲ್ಲಿ ಇರಿಸಿ',
      why: 'ಅದೇ ಗಾಳಿಯಲ್ಲಿ ಅವರ ಶ್ವಾಸಕೋಶ ಹೆಚ್ಚು ಕಣಗಳನ್ನು ಸೇವಿಸುತ್ತದೆ, ಕಡಿಮೆ ಸಾಂದ್ರತೆಯಲ್ಲೂ ಲಕ್ಷಣ ಕಾಣಬಹುದು.',
      impact: `ಕಿಟಕಿ ಮುಚ್ಚಿ ಪ್ಯೂರಿಫೈಯರ್ ಚಾಲನೆ ಮಾಡಿದರೆ ಅವರ ಒಡ್ಡಿಕೆ ಸುಮಾರು ${m.pct}% ಕಡಿಮೆ.`,
      basis: '12 ಗಂಟೆ ಮುಚ್ಚಿದ ಕಿಟಕಿ ಮತ್ತು HEPA; ಸಲಹೆ CPCB ಆರೋಗ್ಯ ಸೂಚನೆಗಳಿಗೆ ಅನುಗುಣ.',
    }),
  },
  bestWindow: {
    en: (m) => ({
      action: `Plan errands and walks for ${m.start}–${m.end}`,
      why: `PM2.5 is forecast lowest then — about ${m.pct}% below the 24-hour average — so the same trip costs you less.`,
      impact: `About ${m.pct}% less PM2.5 for time spent outside in that window.`,
      basis: 'Open-Meteo hourly PM2.5 forecast; 2-hour rolling average within daylight hours.',
    }),
    hi: (m) => ({
      action: `काम और सैर ${m.start}–${m.end} के बीच रखें`,
      why: `तब PM2.5 सबसे कम रहने का अनुमान है — 24 घंटे के औसत से करीब ${m.pct}% नीचे — इसलिए वही सफ़र कम भारी पड़ेगा।`,
      impact: `उस समय बाहर रहने पर करीब ${m.pct}% कम PM2.5।`,
      basis: 'Open-Meteo घंटेवार PM2.5 पूर्वानुमान; दिन के उजाले में 2 घंटे का औसत।',
    }),
    kn: (m) => ({
      action: `ಕೆಲಸ ಮತ್ತು ನಡಿಗೆಯನ್ನು ${m.start}–${m.end} ನಡುವೆ ಯೋಜಿಸಿ`,
      why: `ಆಗ PM2.5 ಕನಿಷ್ಠ ಇರುವ ಮುನ್ಸೂಚನೆ — 24 ಗಂಟೆ ಸರಾಸರಿಗಿಂತ ಸುಮಾರು ${m.pct}% ಕಡಿಮೆ — ಹಾಗಾಗಿ ಅದೇ ಪ್ರಯಾಣ ಕಡಿಮೆ ಭಾರ.`,
      impact: `ಆ ಸಮಯದಲ್ಲಿ ಹೊರಗೆ ಇದ್ದರೆ ಸುಮಾರು ${m.pct}% ಕಡಿಮೆ PM2.5.`,
      basis: 'Open-Meteo ಗಂಟೆವಾರು PM2.5 ಮುನ್ಸೂಚನೆ; ಹಗಲಿನಲ್ಲಿ 2 ಗಂಟೆ ಸರಾಸರಿ.',
    }),
  },
  greenCommute: {
    en: (m) => ({
      action: m.cleanAlready
        ? 'Keep choosing metro, bus, walking or cycling for your commute'
        : m.near
          ? 'Swap short trips under 5 km to walking, cycling or the metro'
          : 'Take the metro for this commute and club errands into one trip',
      why: 'Transport is a large share of city PM2.5 and CO₂; the cleanest trip is the one not taken by private vehicle.',
      impact: m.cleanAlready
        ? `Your commute already emits about ${m.co2} kg CO₂ a week — keep it up.`
        : `Up to ${m.co2} kg CO₂ saved each week if this ${m.distance} km one-way commute moves to the metro or to walking.`,
      basis:
        'Car 0.17, two-wheeler 0.05, bus 0.04 and metro 0.03 kg CO₂ per passenger-km over a 5-day week.',
    }),
    hi: (m) => ({
      action: m.cleanAlready
        ? 'सफ़र में मेट्रो, बस, पैदल या साइकिल चुनते रहें'
        : m.near
          ? '5 किमी से छोटे सफ़र पैदल, साइकिल या मेट्रो से करें'
          : 'इस सफ़र के लिए मेट्रो लें और छोटे काम एक ही फेरे में निपटाएँ',
      why: 'परिवहन शहर के PM2.5 और CO₂ का बड़ा हिस्सा है; सबसे साफ़ सफ़र वह है जो निजी वाहन से न हो।',
      impact: m.cleanAlready
        ? `आपका सफ़र पहले ही हफ़्ते में करीब ${m.co2} किग्रा CO₂ छोड़ता है — ऐसे ही जारी रखें।`
        : `${m.distance} किमी के इस एकतरफ़ा सफ़र के मेट्रो या पैदल होने पर हर हफ़्ते ${m.co2} किग्रा तक CO₂ की बचत।`,
      basis: 'कार 0.17, दोपहिया 0.05, बस 0.04, मेट्रो 0.03 किग्रा CO₂ प्रति यात्री-किमी, 5 दिन के हफ़्ते पर।',
    }),
    kn: (m) => ({
      action: m.cleanAlready
        ? 'ಪ್ರಯಾಣಕ್ಕೆ ಮೆಟ್ರೋ, ಬಸ್, ನಡಿಗೆ ಅಥವಾ ಸೈಕಲ್ ಆಯ್ಕೆ ಮುಂದುವರಿಸಿ'
        : m.near
          ? '5 ಕಿ.ಮೀ ಒಳಗಿನ ಪ್ರಯಾಣಕ್ಕೆ ನಡಿಗೆ, ಸೈಕಲ್ ಅಥವಾ ಮೆಟ್ರೋ ಬಳಸಿ'
          : 'ಈ ಪ್ರಯಾಣಕ್ಕೆ ಮೆಟ್ರೋ ಬಳಸಿ, ಸಣ್ಣ ಕೆಲಸಗಳನ್ನು ಒಂದೇ ಸುತ್ತಿನಲ್ಲಿ ಮುಗಿಸಿ',
      why: 'ಸಾರಿಗೆ ನಗರದ PM2.5 ಮತ್ತು CO₂ ನ ದೊಡ್ಡ ಪಾಲು; ಖಾಸಗಿ ವಾಹನದಲ್ಲಿ ಮಾಡದ ಪ್ರಯಾಣವೇ ಅತ್ಯಂತ ಸ್ವಚ್ಛ.',
      impact: m.cleanAlready
        ? `ನಿಮ್ಮ ಪ್ರಯಾಣ ಈಗಾಗಲೇ ವಾರಕ್ಕೆ ಸುಮಾರು ${m.co2} ಕಿ.ಗ್ರಾಂ CO₂ ಬಿಡುಗಡೆ ಮಾಡುತ್ತದೆ — ಮುಂದುವರಿಸಿ.`
        : `${m.distance} ಕಿ.ಮೀ ಒಂದು ದಿಕ್ಕಿನ ಈ ಪ್ರಯಾಣ ಮೆಟ್ರೋ ಅಥವಾ ನಡಿಗೆಗೆ ಬದಲಾದರೆ ವಾರಕ್ಕೆ ${m.co2} ಕಿ.ಗ್ರಾಂ ವರೆಗೆ CO₂ ಉಳಿತಾಯ.`,
      basis: 'ಕಾರು 0.17, ದ್ವಿಚಕ್ರ 0.05, ಬಸ್ 0.04, ಮೆಟ್ರೋ 0.03 ಕಿ.ಗ್ರಾಂ CO₂ ಪ್ರತಿ ಪ್ರಯಾಣಿಕ-ಕಿ.ಮೀ, 5 ದಿನದ ವಾರ.',
    }),
  },
  ventilate: {
    en: (m) => ({
      action: 'Open windows for 20–30 minutes during the cleanest hour',
      why: 'On a clean day, flushing stale indoor air lowers CO₂ and indoor pollutants without adding much PM2.5.',
      impact: `No meaningful PM2.5 penalty today; outdoor air is ${m.pm} µg/m³.`,
      basis: 'Outdoor PM2.5 is within the Good or Satisfactory band; ventilation advice follows CPCB guidance.',
    }),
    hi: (m) => ({
      action: 'सबसे साफ़ घंटे में 20–30 मिनट खिड़कियाँ खोलें',
      why: 'साफ़ दिन में बासी घर की हवा बाहर जाने से CO₂ और घरेलू प्रदूषक घटते हैं, PM2.5 ज़्यादा नहीं बढ़ता।',
      impact: `आज PM2.5 का बड़ा नुकसान नहीं; बाहर की हवा ${m.pm} µg/m³ है।`,
      basis: 'बाहर का PM2.5 अच्छा या संतोषजनक श्रेणी में; सलाह CPCB मार्गदर्शन के अनुसार।',
    }),
    kn: (m) => ({
      action: 'ಅತ್ಯಂತ ಸ್ವಚ್ಛ ಗಂಟೆಯಲ್ಲಿ 20–30 ನಿಮಿಷ ಕಿಟಕಿ ತೆರೆಯಿರಿ',
      why: 'ಸ್ವಚ್ಛ ದಿನದಲ್ಲಿ ಹಳೆಯ ಒಳಾಂಗಣ ಗಾಳಿ ಹೊರಹೋದರೆ CO₂ ಮತ್ತು ಒಳ ಮಾಲಿನ್ಯಕಾರಕಗಳು ಕಡಿಮೆಯಾಗುತ್ತವೆ, PM2.5 ಹೆಚ್ಚಾಗುವುದಿಲ್ಲ.',
      impact: `ಇಂದು PM2.5 ನಷ್ಟವಿಲ್ಲ; ಹೊರಗಿನ ಗಾಳಿ ${m.pm} µg/m³.`,
      basis: 'ಹೊರಗಿನ PM2.5 ಉತ್ತಮ ಅಥವಾ ತೃಪ್ತಿಕರ ಶ್ರೇಣಿಯಲ್ಲಿ; ಸಲಹೆ CPCB ಮಾರ್ಗಸೂಚಿ ಪ್ರಕಾರ.',
    }),
  },
  dust: {
    en: () => ({
      action: 'Damp-dust surfaces and skip incense, coils and candles indoors',
      why: 'Settled dust and indoor smoke add particles that a purifier then has to remove; damp cloth traps dust instead of lifting it.',
      impact: 'Cuts a recurring indoor PM2.5 source rather than a measured share of today’s exposure.',
      basis:
        'CPCB indoor-air guidance: avoid burning incense, coils and candles, and clean with a damp cloth. No exposure reduction is claimed because the source strength varies by home.',
    }),
    hi: () => ({
      action: 'सतहों को नम कपड़े से पोंछें और घर के अंदर अगरबत्ती, कॉइल या मोमबत्ती न जलाएँ',
      why: 'जमी धूल और घर का धुआँ कण बढ़ाते हैं जिन्हें प्यूरीफ़ायर को हटाना पड़ता है; नम कपड़ा धूल को उड़ने के बजाय पकड़ लेता है।',
      impact: 'यह घर के PM2.5 का लगातार स्रोत घटाता है, आज के जोखिम का नापा हुआ हिस्सा नहीं।',
      basis:
        'CPCB इनडोर वायु मार्गदर्शन: अगरबत्ती, कॉइल और मोमबत्ती न जलाएँ, नम कपड़े से सफ़ाई करें। घर के हिसाब से स्रोत बदलता है, इसलिए कमी का दावा नहीं।',
    }),
    kn: () => ({
      action: 'ಮೇಲ್ಮೈಗಳನ್ನು ತೇವ ಬಟ್ಟೆಯಿಂದ ಒರೆಸಿ, ಒಳಗೆ ಧೂಪ, ಕಾಯಿಲ್ ಅಥವಾ ಮೋಂಬತ್ತಿ ಬೇಡ',
      why: 'ಕುಳಿತ ಧೂಳು ಮತ್ತು ಒಳಾಂಗಣ ಹೊಗೆ ಕಣಗಳನ್ನು ಸೇರಿಸುತ್ತವೆ, ಅವನ್ನು ಪ್ಯೂರಿಫೈಯರ್ ತೆಗೆಯಬೇಕಾಗುತ್ತದೆ; ತೇವ ಬಟ್ಟೆ ಧೂಳನ್ನು ಎತ್ತದೆ ಹಿಡಿಯುತ್ತದೆ.',
      impact: 'ಇದು ಮನೆಯ PM2.5 ನ ಪುನರಾವರ್ತಿತ ಮೂಲವನ್ನು ಕಡಿಮೆ ಮಾಡುತ್ತದೆ, ಇಂದಿನ ಒಡ್ಡಿಕೆಯ ಅಳತೆ ಮಾಡಿದ ಪಾಲಲ್ಲ.',
      basis:
        'CPCB ಒಳಾಂಗಣ ಗಾಳಿ ಮಾರ್ಗಸೂಚಿ: ಧೂಪ, ಕಾಯಿಲ್, ಮೋಂಬತ್ತಿ ಬೇಡ; ತೇವ ಬಟ್ಟೆಯಿಂದ ಸ್ವಚ್ಛಗೊಳಿಸಿ. ಮನೆಗೆ ಅನುಗುಣವಾಗಿ ಮೂಲ ಬದಲಾಗುವುದರಿಂದ ಕಡಿತದ ಪ್ರಮಾಣ ಸೂಚಿಸಿಲ್ಲ.',
    }),
  },
  quietRoute: {
    en: () => ({
      action: 'Walk and cycle on quieter side streets rather than main roads',
      why: 'Vehicle exhaust stays concentrated along traffic corridors, so the same trip on a side street means fewer particles even on a clean day.',
      impact: 'No measured change today — a qualitative improvement, not a modelled percentage.',
      basis:
        'Qualitative: traffic corridors concentrate vehicle exhaust. No exposure reduction is claimed because street-level concentrations are not measured here.',
    }),
    hi: () => ({
      action: 'मुख्य सड़कों के बजाय शांत गलियों से पैदल चलें और साइकिल चलाएँ',
      why: 'वाहनों का धुआँ ट्रैफ़िक वाली सड़कों पर ही जमा रहता है, इसलिए साफ़ दिन में भी गली के रास्ते कम कण लेते हैं।',
      impact: 'आज कोई नापा हुआ बदलाव नहीं — यह गुणात्मक सुधार है, अनुमानित प्रतिशत नहीं।',
      basis:
        'गुणात्मक: ट्रैफ़िक वाली सड़कों पर वाहनों का धुआँ जमा रहता है। सड़क स्तर की सांद्रता यहाँ नापी नहीं जाती, इसलिए कमी का दावा नहीं।',
    }),
    kn: () => ({
      action: 'ಮುಖ್ಯ ರಸ್ತೆಗಳ ಬದಲು ಶಾಂತ ಪಕ್ಕದ ರಸ್ತೆಗಳಲ್ಲಿ ನಡೆಯಿರಿ ಮತ್ತು ಸೈಕಲ್ ತುಳಿಯಿರಿ',
      why: 'ವಾಹನಗಳ ಹೊಗೆ ಸಂಚಾರದ ರಸ್ತೆಗಳಲ್ಲಿ ಕೇಂದ್ರೀಕೃತವಾಗಿರುತ್ತದೆ, ಹಾಗಾಗಿ ಸ್ವಚ್ಛ ದಿನದಲ್ಲೂ ಪಕ್ಕದ ರಸ್ತೆಯಲ್ಲಿ ಕಡಿಮೆ ಕಣಗಳು ಸಿಗುತ್ತವೆ.',
      impact: 'ಇಂದು ಅಳತೆ ಮಾಡಿದ ಬದಲಾವಣೆ ಇಲ್ಲ — ಇದು ಗುಣಾತ್ಮಕ ಸುಧಾರಣೆ, ಅಂದಾಜು ಶೇಕಡಾವಾರು ಅಲ್ಲ.',
      basis:
        'ಗುಣಾತ್ಮಕ: ಸಂಚಾರದ ರಸ್ತೆಗಳಲ್ಲಿ ವಾಹನ ಹೊಗೆ ಕೇಂದ್ರೀಕೃತ. ರಸ್ತೆ ಮಟ್ಟದ ಸಾಂದ್ರತೆ ಇಲ್ಲಿ ಅಳೆಯುವುದಿಲ್ಲ, ಹಾಗಾಗಿ ಕಡಿತದ ಪ್ರಮಾಣ ಸೂಚಿಸಿಲ್ಲ.',
    }),
  },
  cookVent: {
    en: (m) => ({
      action: 'Switch on the exhaust fan or chimney every time you cook',
      why: 'Ventilation at the stove removes the cooking plume before it spreads through the home.',
      impact: `About ${m.pct}% less cooking-related PM2.5 indoors.`,
      basis: 'A working exhaust fan is assumed to remove about 60% of the cooking plume; first-order estimate.',
    }),
    hi: (m) => ({
      action: 'हर बार खाना पकाते समय एग्ज़ॉस्ट फ़ैन या चिमनी चालू करें',
      why: 'चूल्हे के पास वेंटिलेशन खाना पकाने का धुआँ घर में फैलने से पहले निकाल देता है।',
      impact: `खाना पकाने से जुड़ा घर का PM2.5 करीब ${m.pct}% कम।`,
      basis: 'चलता हुआ एग्ज़ॉस्ट फ़ैन धुएँ का करीब 60% हटाता है; प्रथम-स्तरीय अनुमान।',
    }),
    kn: (m) => ({
      action: 'ಅಡುಗೆ ಮಾಡುವ ಪ್ರತಿ ಬಾರಿ ಎಕ್ಸಾಸ್ಟ್ ಫ್ಯಾನ್ ಅಥವಾ ಚಿಮಣಿ ಆನ್ ಮಾಡಿ',
      why: 'ಒಲೆಯ ಬಳಿಯ ವೆಂಟಿಲೇಶನ್ ಅಡುಗೆಯ ಹೊಗೆಯನ್ನು ಮನೆಯೆಲ್ಲಾ ಹರಡುವ ಮೊದಲು ಹೊರಹಾಕುತ್ತದೆ.',
      impact: `ಅಡುಗೆಗೆ ಸಂಬಂಧಿಸಿದ ಒಳಾಂಗಣ PM2.5 ಸುಮಾರು ${m.pct}% ಕಡಿಮೆ.`,
      basis: 'ಕೆಲಸ ಮಾಡುವ ಎಕ್ಸಾಸ್ಟ್ ಫ್ಯಾನ್ ಹೊಗೆಯ ಸುಮಾರು 60% ತೆಗೆಯುತ್ತದೆ; ಪ್ರಥಮ ಹಂತದ ಅಂದಾಜು.',
    }),
  },
};

const RULES = [
  {
    id: 'sensitive',
    category: 'indoors',
    priority: 100,
    effort: 'med',
    when: ({ aqi, profile }) => aqi > 150 && hasSensitiveGroups(profile),
    patch: (scenario) => ({
      ...scenario,
      windowsOpen: false,
      purifierHours: Math.max(scenario.purifierHours, 12),
    }),
    text: RULE_TEXT.sensitive,
  },
  {
    id: 'mask',
    category: 'routine',
    priority: 95,
    effort: 'low',
    when: ({ aqi, scenario }) => aqi > 100 && scenario.mask !== 'always',
    patch: (scenario) => ({ ...scenario, mask: 'always' }),
    text: RULE_TEXT.mask,
  },
  {
    id: 'exerciseIndoor',
    category: 'routine',
    priority: 90,
    effort: 'low',
    when: ({ aqi, scenario }) =>
      aqi > 100 && scenario.exerciseHours > 0 && !scenario.exerciseIndoor,
    patch: (scenario) => ({ ...scenario, exerciseIndoor: true }),
    text: RULE_TEXT.exerciseIndoor,
  },
  {
    id: 'purifier',
    category: 'indoors',
    priority: 86,
    effort: 'med',
    when: ({ aqi, scenario }) => aqi > 100 && scenario.purifierHours < 8,
    patch: (scenario) => ({ ...scenario, purifierHours: 10 }),
    text: RULE_TEXT.purifier,
  },
  {
    id: 'closeWindows',
    category: 'indoors',
    priority: 82,
    effort: 'low',
    when: ({ aqi, scenario }) => aqi > 100 && scenario.windowsOpen,
    patch: (scenario) => ({ ...scenario, windowsOpen: false }),
    text: RULE_TEXT.closeWindows,
  },
  {
    id: 'fuel',
    category: 'indoors',
    priority: 88,
    effort: 'high',
    when: ({ scenario }) => ['biomass', 'kerosene'].includes(scenario.cookingFuel),
    patch: (scenario) => ({ ...scenario, cookingFuel: 'electric' }),
    text: RULE_TEXT.fuel,
  },
  {
    id: 'metroSwap',
    category: 'sustainable',
    priority: 76,
    effort: 'med',
    when: ({ aqi, scenario }) =>
      aqi > 150 &&
      scenario.wfhDays < 5 &&
      ['car', 'two_wheeler'].includes(scenario.mode) &&
      scenario.metroDaysPerWeek < 2,
    patch: (scenario) => ({ ...scenario, metroDaysPerWeek: 2 }),
    text: RULE_TEXT.metroSwap,
  },
  {
    id: 'greenCommute',
    category: 'sustainable',
    priority: 56,
    effort: 'med',
    when: () => true,
    patch: (scenario) =>
      scenario.oneWayKm <= 5
        ? { ...scenario, mode: 'walk', metroDaysPerWeek: 0 }
        : { ...scenario, mode: 'metro', metroDaysPerWeek: 0 },
    text: RULE_TEXT.greenCommute,
  },
  {
    id: 'bestWindow',
    category: 'routine',
    priority: 60,
    effort: 'low',
    when: ({ bestWindow }) => Boolean(bestWindow),
    patch: null,
    text: RULE_TEXT.bestWindow,
  },
  {
    id: 'quietRoute',
    category: 'routine',
    priority: 40,
    effort: 'low',
    when: ({ aqi }) => aqi <= 100,
    patch: null,
    text: RULE_TEXT.quietRoute,
  },
  {
    id: 'dust',
    category: 'indoors',
    priority: 44,
    effort: 'low',
    when: () => true,
    patch: null,
    text: RULE_TEXT.dust,
  },
  {
    id: 'ventilate',
    category: 'indoors',
    priority: 72,
    effort: 'low',
    when: ({ aqi, scenario }) => aqi <= 100 && !scenario.windowsOpen,
    patch: (scenario) => ({ ...scenario, windowsOpen: true }),
    text: RULE_TEXT.ventilate,
  },
  {
    id: 'cookVent',
    category: 'indoors',
    priority: 48,
    effort: 'low',
    when: ({ scenario }) => scenario.cookingFuel !== 'electric',
    patch: (scenario) => ({ ...scenario, exhaustFan: true }),
    text: RULE_TEXT.cookVent,
  },
];

/** Keep the top items but guarantee each category has a representative. */
function selectItems(candidates, limit = 6) {
  const sorted = [...candidates].sort((a, b) => b.priority - a.priority);
  const selected = sorted.slice(0, limit);

  for (const category of CATEGORY_ORDER) {
    if (selected.some((item) => item.category === category)) continue;
    const replacement = sorted.find(
      (item) => item.category === category && !selected.includes(item)
    );
    if (!replacement) continue;

    for (let index = selected.length - 1; index >= 0; index -= 1) {
      const currentCategory = selected[index].category;
      const count = selected.filter((item) => item.category === currentCategory).length;
      if (count > 1) {
        selected.splice(index, 1);
        break;
      }
    }
    selected.push(replacement);
  }

  return selected.sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
      b.priority - a.priority
  );
}

/**
 * Build the deterministic plan.
 *
 * @param {{aqi: number, pm25: number, profile: object, bestWindow: ?object, lang: string}} input
 */
export function buildRulePlan({ aqi, pm25, profile, bestWindow, lang = 'en' }) {
  const baseScenario = profileToScenario(profile);
  const baseline = estimateExposure(baseScenario, pm25);
  const baseCo2 = weeklyCommuteCo2Kg(baseScenario);
  const windowLabel = bestWindow
    ? {
        start: formatWindowHour(bestWindow.startHour, lang),
        end: formatWindowHour(bestWindow.endHour, lang),
      }
    : { start: '', end: '' };

  const candidates = RULES.filter((rule) =>
    rule.when({ aqi, pm25, profile, scenario: baseScenario, bestWindow })
  ).map((rule) => {
    const patched = rule.patch ? rule.patch(baseScenario) : baseScenario;
    const after = estimateExposure(patched, pm25);
    const co2After = weeklyCommuteCo2Kg(patched);

    let reductionPct = baseline.doseUg > 0 ? (1 - after.doseUg / baseline.doseUg) * 100 : 0;
    if (rule.id === 'bestWindow' && bestWindow) {
      // Compare the clean window against the 24-hour average concentration.
      reductionPct = pm25 > 0 ? (1 - bestWindow.pm25 / pm25) * 100 : 0;
    }
    if (rule.id === 'cookVent' || rule.id === 'fuel') {
      // Report the cooking plume removed, which is what these changes affect;
      // the whole-day share would round to a misleading "0%" or "2%".
      const plumeBefore = cookingPm25(baseScenario);
      const plumeAfter = cookingPm25(patched);
      reductionPct = plumeBefore > 0 ? (1 - plumeAfter / plumeBefore) * 100 : 0;
    }

    const metrics = {
      pct: pct(reductionPct),
      cigs: oneDecimal((baseline.cigarettesPerDay - after.cigarettesPerDay) * 7),
      co2: oneDecimal(Math.max(0, baseCo2 - co2After)),
      aqi: Math.round(aqi),
      pm: Math.round(pm25),
      metroDays: Math.min(2, 5 - baseScenario.wfhDays),
      distance: Math.round(baseScenario.oneWayKm),
      near: baseScenario.oneWayKm <= 5,
      mode: modeLabel(baseScenario.mode, lang),
      start: windowLabel.start,
      end: windowLabel.end,
      cleanAlready: ['metro', 'bus', 'walk', 'cycle'].includes(baseScenario.mode),
    };

    const copy = (rule.text[lang] || rule.text.en)(metrics);

    return {
      id: rule.id,
      category: rule.category,
      effort: rule.effort,
      priority: rule.priority,
      action: copy.action,
      why_it_helps: copy.why,
      estimated_impact: copy.impact,
      basis: copy.basis,
    };
  });

  return selectItems(candidates).map(({ priority, ...item }) => item);
}

/** A short localised hour label for plan copy. */
function formatWindowHour(hour, lang) {
  try {
    const date = new Date(2024, 0, 1, hour, 0, 0);
    return new Intl.DateTimeFormat(
      lang === 'hi' ? 'hi-IN' : lang === 'kn' ? 'kn-IN' : 'en-IN',
      { hour: 'numeric', hour12: true }
    ).format(date);
  } catch {
    return `${hour}:00`;
  }
}

/**
 * Health-safety notices derived from the AQI and profile. Never diagnostic.
 */
export function healthWarnings({ aqi, profile, lang = 'en' }) {
  const warnings = [];

  if (aqi > 300) {
    warnings.push({ level: 'danger', text: t('warn.avoidExertion', lang, { aqi: Math.round(aqi) }) });
  } else if (aqi > 200 && hasSensitiveGroups(profile)) {
    warnings.push({
      level: 'danger',
      text: t('warn.sensitiveStayIn', lang, { aqi: Math.round(aqi) }),
    });
  } else if (aqi > 100 && hasSensitiveGroups(profile)) {
    warnings.push({
      level: 'warn',
      text: t('warn.sensitiveGeneral', lang, { aqi: Math.round(aqi) }),
    });
  } else if (aqi <= 100) {
    warnings.push({ level: 'info', text: t('warn.cleanDay', lang) });
  }

  if (profile.household.includes('asthma')) {
    warnings.push({ level: 'warn', text: t('warn.asthma', lang) });
  }

  warnings.push({ level: 'info', text: t('warn.doctor', lang) });
  return warnings;
}

/** Category display order and labels, shared with the view. */
export const PLAN_CATEGORIES = CATEGORY_ORDER.map((id) => ({
  id,
  labelKey: CATEGORY_LABELS[id],
}));
