# 60-second demo — a bad-air day (demo mode, no key needed)

**Scenario:** a winter smog morning in Delhi, AQI 320 ("Very poor"), PM2.5 145 µg/m³. Everything
below runs from the built-in sample, so the demo is identical on every machine and works offline:
click **Load Delhi smog sample** in *Where are you?* and the **Sample data** badge appears. The app is
open at `http://127.0.0.1:5173`.

The sample is fixed on purpose: 18 November, 08:00, with a morning peak around 7 am, a cleaner
afternoon window at 2–4 pm and an evening peak after 9 pm. No key is required. If you want to show
live data instead, pick a quick city — but say the number out loud, because it will differ.

| Time | Do | Say |
| --- | --- | --- |
| 0:00–0:06 | Open the app, click **Load Delhi smog sample**. Point at the **Sample data** badge and the red banner. | "This is a fixed Delhi smog morning: AQI 320, very poor. The badge is deliberate — this is sample data, not a live reading. Most apps stop at the number; this one tells you what to do about it." |
| 0:06–0:16 | Scroll to **Your day, hour by hour**. Read the three slots. | "Morning, afternoon, evening — built from the hourly forecast and my profile. Skip the 7 am run: AQI 325 then. The clean window is 2 to 4 pm at 227. Close the windows before the 9 pm peak at 370. One action, one number, per slot." |
| 0:16–0:26 | Scroll to **Today's plan**. Open the N95 card's **How is this calculated?** | "Every action carries its own impact and the maths behind it: N95 filtration, 22 micrograms equals one cigarette, a one-hour commute. About 90% fewer particles on the commute — roughly 1.5 fewer cigarette-equivalents a week." |
| 0:26–0:36 | Ask a question in **Ask about today's air**: tap the chip *Is it safe to go out this evening?* | "It answers from the same context — city, AQI, forecast, profile, plan. With a key it streams from Gemini under hard rules: no diagnosis, no invented statistics, and it treats my question as data, not instructions. Without a key you still get a useful answer, marked as offline." |
| 0:36–0:46 | Scroll to **What-if simulator**. Set metro to **3 days**, purifier to **8 hours**, mask to **Always (N95)**. | "Before and after, side by side: 1,934 to 1,469 micrograms inhaled a day, 4.6 to 3.5 cigarettes, one kilo of CO₂ saved a week. The headline is the summary: 24% less exposure." |
| 0:46–0:54 | Press **Share my plan**, then switch the language to **हिन्दी**. | "It copies a short plan — city, AQI, top four actions — or opens the system share sheet. And the whole thing, timeline and chat included, is translated: English, Hindi, Kannada." |
| 0:54–1:00 | Scroll to the footer / health notice. | "It never diagnoses. Sensitive groups come first, and persistent symptoms mean a doctor. Calm, specific, and honest that these are estimates for comparison, not measurements." |

## If you only have 30 seconds

Demo sample → timeline → one **How is this calculated?** → before/after headline. That is the whole
story: the number, what to do about it, and what it is worth.

## Optional: show Gemini

Open **Gemini API key** under the plan, paste a key, press **Personalise with Gemini**. Say: "The
rule-based plan stays on screen while Gemini rewrites it from the same data; if the call fails, the
rules remain." Then return to **Ask about today's air** and ask a second question to show streaming.

## If Gemini is unavailable

Skip that step. Say: "No key configured, so the transparent rule engine provides the plan and the
offline answers — same cards, same explanations. Gemini is an enhancement, never a dependency." This
is the state the app ships in, so the demo works with zero setup.

## Lines to avoid

- Do not call the sample live data, and do not hide the **Sample data** badge.
- Do not claim the numbers are measured personal exposure; they are first-order estimates.
- Do not promise health outcomes ("this will protect your lungs"); describe exposure and emissions.
- Do not read every card aloud. Two cards, one basis expander, the timeline and the simulator are
  enough for a minute.
