# Prompt Tuning Log

Per Week 4 spec §4.1. One row per observed failure, logged during each real-building test session.
Fill in after each session — do not pre-fill with assumed data.

Failure types: Too vague | Missed obstacle | False high urgency | Wrong direction | Goal false negative | Goal false positive | Repetition

## Session 1 — 6/18/26 — Play room

| # | Frame context | Claude output | Expected output | Failure type |
|---|---|---|---|---|
| 1 | Washroom door had been found earlier, but a different door looked similar later | Said "in front" while already facing the opposite way and later misidentified another door as the washroom | Keep the previously found washroom door in memory and continue guiding to the correct one | Wrong direction |

**Most common failure type this session:** Wrong direction
**Prompt change made (spec §4.2 — one change at a time):** Added last-seen destination and spatial-memory hints so the prompt could route back to the previously identified washroom door instead of losing track.

---

## Session 2 — 6/19/26 — Play room

| # | Frame context | Claude output | Expected output | Failure type |
|---|---|---|---|---|
| 1 | Storage door identified by sign in a large room | Could not read the sign and guided the user elsewhere outside the room | Follow the sign/arrow and keep the destination anchored to the correct door | Goal false negative |

**Most common failure type this session:** Goal false negative
**Prompt change made:** Added explicit sign-direction handling so wayfinding signs with arrows are treated as routing cues rather than arrival markers.

---

## Session 3 — 6/20/26 — Home (lit)

| # | Frame context | Claude output | Expected output | Failure type |
|---|---|---|---|---|
| 1 | Guitar off to the left of the user | Said the guitar was "directly ahead" and later claimed arrival while still far away | Scan first, then say to move left if the guitar is off to the side; do not declare arrival until the user is truly at the object | Wrong direction |
| 2 | Bathroom scene after the user had already turned | Directions were delayed and reflected stale scene info from several seconds earlier | Keep instructions grounded in the latest frame and avoid stale guidance after a turn | Goal false positive |

**Most common failure type this session:** Wrong direction
**Prompt change made:** Tightened the prompt to reduce stale/latency phrasing, prefer the last-known destination direction when it leaves the frame, and avoid premature arrival claims.

---

## Session 4 — 6/27/26 — Field observations

| # | Frame context | Claude output | Expected output | Failure type |
|---|---|---|---|---|
| 1 | Repeated guidance around the same landmark or doorway across turns | Repeated the same instruction instead of retaining earlier context | Keep a short memory of prior turns and avoid repeating the same event/instruction | Repetition |
| 2 | Multiple turns in a hallway or doorway sequence | Only acted on the most recent frame and dropped earlier scan context | Carry earlier scan/turn context forward so the model can choose across the full sequence | Wrong direction |

**Most common failure type this session:** Repetition
**Prompt change made:** Added scan-summary handoff so the explore/navigate prompts could retain the results of the earlier guided scan instead of starting each step with no spatial context.

---

## Session 5 — 6/28/26 — Field observations

| # | Frame context | Claude output | Expected output | Failure type |
|---|---|---|---|---|
| 1 | User had already moved past a side object or doorway | Continued to describe old frame content as if it were still current | Only use the latest relevant frame content and avoid reverberating stale descriptions | Too vague |
| 2 | A corridor or junction was briefly visible then passed | Guidance jumped to the last frame and lost the earlier path context | Preserve recent path context and avoid reacting only to the final frame in a sequence | Wrong direction |

**Most common failure type this session:** Wrong direction
**Prompt change made:** Added prompt rules to remember blocked headings and to prefer current-frame guidance over stale frame descriptions when the user has already moved.
