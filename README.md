# StripeRide

A landing page for the Middlesex School town shuttle: a live 3D map of the shuttle's route from Curtis Center into Concord center, with the next stop and arrival time always on screen.

**Live site:** https://axanderz.github.io/MX-UX-Project-2/

## What's here

- `index.html`: the app: a full-screen live map with four tabs (Live, Stops, Times, Pickups)
- `pickup.html`: redirects old links to the Pickups tab
- `assets/css/styles.css`: styles (black, white, and Middlesex red `#D31245`)
- `assets/js/main.js`: tabs, the next-stop sheet, the Stops and Times panels, and the intro motion (GSAP)
- `assets/js/map.js`: the 3D map (Three.js)
- `assets/js/schedule.js`: the shuttle timing model (simulated until real GPS is connected)
- `assets/js/pickup.js`: the Pickups tab
- `assets/js/auth.js`, `assets/js/firebase-config.js`: Google sign-in (@mxschool.edu only) and pickup storage in Firestore
- `firestore.rules`: who can read and write pickups
- `assets/data/concord.json`: streets, buildings, water, and the route, from OpenStreetMap

## Status

Work in progress for UX class. The shuttle's position is simulated from the clock (it leaves Curtis Center at :00, :20, and :40); service hours are placeholders.

Preview options: add `?speed=20` to the URL to run the shuttle 20x faster, or `?offset=8` to jump 8 minutes into the loop.

## Credits

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available under the ODbL.
