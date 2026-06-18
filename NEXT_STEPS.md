# Next steps / roadmap

Captured for the next working session. The vision is shifting from "manually
highlight passages" toward **"turn a paper into a short, narrated research
digest you can watch on the go."** Three features drive that:

---

## 1. Duration window: 1–3 minutes total

**Requirement:** the exported B-roll must be **at least 1:00 and at most 3:00**.

Current state: total is just the sum of per-selection durations + intro, often
~10s.

**Plan:**
- Show the **running total** in the sidebar (live) with a clear in-range / out-of-range
  indicator (e.g. green between 60–180s, amber otherwise).
- Tie step durations to narration length once voiceover exists (see §2): each
  step lasts at least as long as its narration, so total naturally grows with the
  number/length of highlights.
- Add a **"Fit to target"** helper: pick a target length (e.g. 90s) and auto-
  distribute/pad step durations to land in range. Block export (with a clear
  message) if outside 1–3 min, or offer to auto-fit.
- Constants to add: `MIN_TOTAL = 60`, `MAX_TOTAL = 180` (seconds).

---

## 2. Voiceover / narration (currently silent)

**Requirement:** add a voice track — the video is currently silent.

**Design:**
- Each selection gets a **narration script** field (defaults to the selected
  text, editable; ideally an LLM-written summary — see §3).
- Synthesize narration to audio per step (TTS), then **mux audio into the MP4**
  with ffmpeg (we already bundle ffmpeg). Concatenate per-step clips on a
  timeline so each highlight is on screen while its line is spoken.
- Step duration = max(user duration, narration audio duration) so visuals and
  audio stay in sync.

**Open decision — TTS engine (pick next session):**
| Option | Quality | Network/keys | Notes |
|--------|---------|--------------|-------|
| OS built-in (`say` on macOS, SAPI on Windows, `espeak-ng` on Linux) | robotic | none, offline | zero-config default, good fallback |
| Cloud TTS (ElevenLabs / OpenAI / Azure / Google) | natural | API key + network | best for a "podcast" feel; add a settings field for the key |

**Recommendation:** pluggable provider — ship the OS engine as the no-setup
default, and let the user paste an API key to upgrade to a natural cloud voice.
Add voice picker + speed control in settings.

**Implementation notes:**
- ffmpeg mux: render silent video frames as today, generate `narration.wav/mp3`,
  then `ffmpeg -i video.mp4 -i narration.mp3 -c:v copy -c:a aac -shortest out.mp4`.
- For precise sync, generate one audio file per step, get each duration, and set
  the step length to it before rendering frames (so timing is known up front).

---

## 3. Auto-capture the paper's key highlights ("research on the go")

**Requirement:** the digest should surface the paper's **key highlights**
automatically, so a user stays updated without reading the whole paper or
hand-highlighting.

**Plan:**
- Add **"Auto-highlight"**: analyze the loaded article/PDF and propose ~5–8 key
  passages, each becoming a narrated B-roll segment. User can reorder / edit /
  delete before export.
- Sources of "key" content, in priority order:
  1. Structured sections: **Abstract**, **Key points / Highlights /
     Implications / Key practitioner points**, **Conclusion**.
  2. Headings + first sentence of each major section.
  3. LLM extraction/summarization for a clean 5–8 bullet digest.
- We already extract PDF text (PDF.js `getTextContent`) and web text (DOM); reuse
  that to locate these sections and their on-page rectangles for the animation.

**Open decision — summarizer:**
- **Claude API** (best quality; needs an API key — see `claude-api` skill for
  model ids/usage). Use the latest model; write 1 concise spoken line per
  highlight.
- **Heuristic fallback** (no key): grab Abstract + any "Highlights/Key points"
  list + Conclusion sentences.

**Recommendation:** Claude API when a key is present, heuristic otherwise. Each
auto-highlight carries both the on-page rect (for the zoom/animation) and the
narration line (for §2).

---

## Suggested build order for next session
1. Live total-duration indicator + 1–3 min enforcement / "Fit to target". (small)
2. Narration field per selection + ffmpeg audio mux with OS TTS default. (medium)
3. Auto-highlight extraction (heuristic first, then Claude API option). (medium)
4. Wire duration to narration length; settings panel for voice + API key. (small)

## Decisions to confirm when we resume
- TTS engine default + whether to support a cloud key now.
- Summarizer: Claude API now, or heuristic-only for v1.
- Target default length (proposed: 90s) and whether export hard-blocks outside
  1–3 min or just warns.

---

## Environment reminders (for whoever resumes)
- Desktop app; run on a real machine (`npm start` / `./run.sh`). The cloud
  sandbox can't load remote article URLs (TLS-intercepting egress proxy) and its
  headless GPU makes CDP screenshot capture hang — both work fine on a real
  desktop. PDF path avoids GPU capture (stitches PDF.js canvases).
- Work continues on branch `claude/nice-franklin-v3qbav` (PR #1).
