# Orbit & Glow

A color-sort puzzle prototype: send comets around a night-sky orbit to clear a picture made of
stardust. Designed in [gamecrafter](https://github.com/kpflynn82/gamecrafter)
(`prototype-specs/orbit-and-glow.md`); built web-first so it plays from a link on a phone.

**Status: M1 + fusion (gray box).** Orbit, rails, Dock, order-only rules, fusion, both kinds of
stuck, free retry, color-blind glyphs, coach tips, 20 solver-checked levels judged by a "sensible
player" bot. No art or sound yet. See `docs/brief.md`.

## How to play

Tap the front comet on a rail. It flies one lap around the orbit and clears every speck of its
color that it can see from the edge (only the first speck in each row or column). If it still has
charge after the lap, it parks in the Dock; tap it there to send it again later. Clear the whole
picture to win. You're stuck if a comet has to park and the Dock is full (and no fusion can make
room), or if some color can no longer be cleared by any comet or fusion — retry is free.
From level 6, drag one docked comet onto another to **fuse** them: Red + Yellow = Orange,
Yellow + Blue = Green, Red + Blue = Purple, charges added. Sending a comet that can't hit anything
yet is how you park it, ready to fuse. If a comet comes back to a full Dock, it waits at the gate
until you fuse two docked comets to make room.
Tap several comets quickly and they wait their turn beside the gate, one lap at a time.
Nothing depends on how fast you tap; only the order matters.

## Running it

You need Node.js 22. Then:

```
npm install
npm run dev        # open the printed Local address; a phone on the same Wi-Fi can use the Network one
npm test           # rules and level checks
npm run bot        # a bot plays every level (solver path + random games)
```

More commands and the project rules are in `CLAUDE.md`. What went wrong and what we learned is
in `LESSONS.md`.

## Deploying (Vercel)

The repo includes `vercel.json`. On vercel.com: Add New → Project → import
`kpflynn82/orbit-and-glow` → Deploy. Every push to `main` then updates the phone link.
