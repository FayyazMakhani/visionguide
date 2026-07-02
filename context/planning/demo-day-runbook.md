# Demo Day Runbook

Per Week 4 spec §14. Print this or keep it on a separate device. Do not rely on memory under pressure.
Fill in the bracketed venue/destination-specific fields before demo day.

## Setup (T-30 minutes)

```
[ ] Confirm venue WiFi SSID and password: [fill in]
[ ] Connect demo device to venue WiFi — confirm API call succeeds
[ ] Open VisionGuide URL in Chrome on demo device: [fill in deployed URL]
[ ] Dismiss onboarding (already visited)
[ ] Set volume to maximum
[ ] Confirm Do Not Disturb is on
[ ] Charge to 100%
[ ] Walk the demo route once with app running — confirm it still works in this environment
[ ] Note current API latency from console (venue WiFi may differ from dev environment): [fill in]
```

## Demo Sequence

```
Step 1: Open VisionGuide in Chrome on demo device
Step 2: Show audience the UI — "One input, one button"
Step 3: Speak or type the destination: "[demo destination]"
Step 4: Tap Start Navigation
Step 5: Safety prompt plays — wait for it to finish
Step 6: Walk the route — let directions play naturally, do not narrate over them
Step 7: Approach the planted obstacle — let alert fire
Step 8: Continue to destination — let arrival announcement play
Step 9: Tap Stop
```

## Failure Contingencies

| Failure | Immediate action |
|---|---|
| Camera permission denied | Open Chrome Settings > Site Settings > Camera > Allow for this site |
| No speech output | Check volume. Check headset is not connected. Reload page. |
| "Still scanning" on every cycle | API latency too high on venue WiFi. Switch to mobile hotspot. |
| App crashes / blank screen | Reload the Vercel URL. Session state is lost — re-enter goal. |
| Goal never detected | Walk closer to the destination. Destination under 2 metres works best. |
| Obstacle not alerted | Reposition obstacle to be more centered in frame. |
| Vercel URL unreachable | Run `npm run dev` on a laptop, connect demo device to laptop hotspot, use `http://[laptop-ip]:5173` |

## Backup Device

Have a second phone with the app pre-loaded at the Vercel URL, camera tested, and volume set.
If the primary device fails in any unrecoverable way, hand-off to the backup device takes under 30 seconds.

**Backup device prepared:** [ ] yes / [ ] no
