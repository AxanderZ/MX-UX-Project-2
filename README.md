# StripeRide

A landing page for the Middlesex School town shuttle: a live 3D map of the shuttle's route from Curtis Center into Concord center, with the next stop and arrival time always on screen.

**Live site:** https://axanderz.github.io/MX-UX-Project-2/

## What's here

- `index.html`: the page
- `assets/css/styles.css`: styles (black, white, and Middlesex red `#D31245`)
- `assets/js/main.js`: page motion (GSAP + ScrollTrigger) and the next-stop sheet
- `assets/js/map.js`: the 3D map (Three.js)
- `assets/js/schedule.js`: the shuttle timing model (simulated until real GPS is connected)
- `assets/data/concord.json`: streets, buildings, water, and the route, from OpenStreetMap

## Status

Work in progress for UX class. The shuttle's position is simulated from the clock (it leaves Curtis Center at :00, :20, and :40); service hours are placeholders.

Preview options: add `?speed=20` to the URL to run the shuttle 20x faster, or `?offset=8` to jump 8 minutes into the loop.

## Credits

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available under the ODbL.
