**Next steps:** 
6/29/2025
- Create a plotly plot for the shot data from trackman. Start determining how to create the dispersion oval (shots must be same club, shot type, and player) and identify the worst 20% of shots to exclude and mark differently. Plot all of them on the same graph with dropdowns for each shot type and player (option to display all for each player)
- Consider using the model to generate trajectories in the future

7/17/2025
- Currently have Dash app using plotly. Manually downloading courses using Overpass-turbo query. Script loads in the geojson features, displays in plotly, then allows for an adjustable dispersion oval, pin setting, and optimization based on expected strokes calculations. Features exist to rotate the views, but they are finnicky at best.
- Attempted to incorporate elevation data (actually did successfully), but it was not granular enough to be useful. Course geojson features were automated from a search bar and overpass turbo api. Very slow process to load these features in, and no new insight was generated from the not-very-granular data.

- Next thoughts: switch back to Cesium Ion for granular elevation data and 'GPS' feel. I have previously overlayed geojson features to Cesium ION, flattened to the ground, and been able to access elevation data at a given point.
- Elevation info could be insightful for modifying the expected strokes calculation.
- Consider building into a directory instead of one script. AI has trouble fixing entire script, and it becomes very confusing.
- Consider making things faster.
- Consider a more user-friendly interface. may be time to build a front end.


**If successful, we could build this directly into the entire mapping calculator.**
- Requires using ovals from profile (could store lightweight with 4 values -- center (distance from starting point), depth, width, tilt).
- Requires the ability to set starting point, aim, and pin (and locking them until changed).
- Need to defeat the physics model issues in cesium (we dont need visual shot trajectories, but still need the values). I think this needs to run inside of cesium if we want to utilize the landing elevation.
- Utilize wind speed, direction, and gust speed. maybe even wind shear if possible.
- Consider better data entry than decade for post-round stats. such a pain currently, but useful stuff.
