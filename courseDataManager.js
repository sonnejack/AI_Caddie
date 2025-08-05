/**
 * Course Data Manager
 * Handles batched GeoJSON processing and course feature management
 */

class CourseDataManager {
  constructor(viewer) {
    this.viewer = viewer;
    this.layers = {};
    this.courseFeatures = {
      greens: [],
      fairways: [],
      bunkers: [],
      roughs: [],
      tees: [],
      water: [],
      holes: []
    };
    
    // Optimization caches
    this.holeMap = new Map();
    this.greenMap = new Map();
    this.teeMap = new Map();
    this.bunkerMap = new Map();
    this.waterMap = new Map();
    this.spatialIndex = null;
    
    // Processing state
    this.isProcessing = false;
    this.processingJob = null;
  }

  /**
   * Initialize data source layers with optimized settings
   */
  initializeLayers() {
    const layerConfigs = {
      bunkers: { name: 'bunkers', clustering: false },
      greens: { name: 'greens', clustering: false },
      fairways: { name: 'fairways', clustering: false },
      tees: { name: 'tees', clustering: false },
      roughs: { name: 'roughs', clustering: false },
      water: { name: 'water', clustering: false },
      normalrough: { name: 'normalrough', clustering: false },
      ob: { name: 'ob', clustering: false },
      cartpaths: { name: 'cartpaths', clustering: false },
      holes: { name: 'holes', clustering: false },
      holelabels: { name: 'holelabels', clustering: true } // Labels can benefit from clustering
    };

    for (const [key, config] of Object.entries(layerConfigs)) {
      const dataSource = new Cesium.CustomDataSource(config.name);
      
      // Enable clustering for appropriate layers
      if (config.clustering) {
        dataSource.clustering.enabled = true;
        dataSource.clustering.pixelRange = 15;
        dataSource.clustering.minimumClusterSize = 3;
      }
      
      this.layers[key] = dataSource;
      this.viewer.dataSources.add(dataSource);
    }
    
    // Set initial visibility
    this.setInitialVisibility();
    
    console.log('Course Data Manager: Layers initialized');
  }

  /**
   * Set initial layer visibility (main course features visible by default)
   */
  setInitialVisibility() {
    const visibleByDefault = ['holes', 'greens', 'fairways', 'tees', 'bunkers', 'water'];
    const toggleableFeatures = ['greens', 'fairways', 'tees', 'bunkers', 'roughs', 'water', 'normalrough', 'holelabels', 'cartpaths', 'ob'];
    
    Object.keys(this.layers).forEach(layerName => {
      if (this.layers[layerName]) {
        this.layers[layerName].show = visibleByDefault.includes(layerName);
      }
    });
  }

  /**
   * Load and process course data with batching
   */
  async loadCourse(courseIds, progressCallback = null) {
    if (this.isProcessing) {
      console.warn('Course loading already in progress');
      return;
    }
    
    this.isProcessing = true;
    const startTime = performance.now();
    
    try {
      // Step 1: Fetch OSM data
      if (progressCallback) progressCallback({ phase: 'fetching', progress: 0, message: 'Fetching course data...' });
      
      const osmData = await this.fetchOSMData(courseIds);
      
      if (progressCallback) progressCallback({ phase: 'converting', progress: 0.2, message: 'Converting to GeoJSON...' });
      
      // Step 2: Convert to GeoJSON (potentially move to worker)
      const geojson = await this.convertToGeoJSON(osmData);
      
      // Store for debugging/download
      this.currentGeoJSON = geojson;
      
      if (progressCallback) progressCallback({ phase: 'processing', progress: 0.4, message: 'Processing features...' });
      
      // Step 3: Process features in batches
      await this.processFeaturesInBatches(geojson.features, progressCallback);
      
      if (progressCallback) progressCallback({ phase: 'matching', progress: 0.8, message: 'Matching greens and tees...' });
      
      // Step 4: Optimized green/tee matching
      await this.matchGreensAndTees();
      
      if (progressCallback) progressCallback({ phase: 'complete', progress: 1.0, message: 'Course loaded successfully' });
      
      const totalTime = performance.now() - startTime;
      console.log(`Course loaded in ${totalTime.toFixed(1)}ms`);
      
      // Step 5: Set initial camera view
      await this.setInitialView();
      
    } catch (error) {
      console.error('Error loading course:', error);
      throw error;
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Search for golf courses by name using Nominatim + Overpass
   */
  async searchCoursesByName(courseName, maxResults = 10) {
    try {
      // Step 1: Use Nominatim to find golf courses by name
      const nominatimUrl = `https://nominatim.openstreetmap.org/search?` +
        `q=${encodeURIComponent(courseName + ' golf course')}&` +
        `format=json&` +
        `limit=${maxResults}&` +
        `addressdetails=1&` +
        `extratags=1&` +
        `namedetails=1&` +
        `class=leisure&` +
        `type=golf_course`;
      
      const nominatimResponse = await fetch(nominatimUrl, {
        headers: { 'User-Agent': 'AI-Caddie/1.0' } // Nominatim requires User-Agent
      });
      
      if (!nominatimResponse.ok) {
        throw new Error(`Nominatim search failed: ${nominatimResponse.statusText}`);
      }
      
      const nominatimData = await nominatimResponse.json();
      
      if (nominatimData.length === 0) {
        console.log('No results from Nominatim, falling back to Overpass direct search...');
        return await this.fallbackOverpassSearch(courseName, maxResults);
      }
      
      // Step 2: Process Nominatim results and format for our system
      console.log('Raw Nominatim results:', nominatimData);
      
      const courses = nominatimData
        .filter(result => result.osm_type && result.osm_id)
        .slice(0, maxResults)
        .map(result => {
          console.log(`Processing Nominatim result: ${result.display_name} (${result.osm_type}:${result.osm_id})`);
          
          // Generate the proper ID format for Overpass API
          // For relations, we need the area ID which is relation_id + 3600000000
          let courseId;
          if (result.osm_type === 'relation') {
            const areaId = parseInt(result.osm_id) + 3600000000;
            courseId = areaId.toString();
            console.log(`Relation ${result.osm_id} -> Area ID ${courseId}`);
          } else if (result.osm_type === 'way') {
            const areaId = parseInt(result.osm_id) + 2400000000;
            courseId = areaId.toString();
            console.log(`Way ${result.osm_id} -> Area ID ${courseId}`);
          } else {
            // Skip nodes as they're not suitable for area queries
            console.log(`Skipping ${result.osm_type} (not suitable for area queries)`);
            return null;
          }
          
          return {
            id: courseId,
            name: result.display_name.split(',')[0], // First part is usually the course name
            city: result.address?.city || result.address?.town || result.address?.village || '',
            state: result.address?.state || '',
            country: result.address?.country || '',
            type: result.osm_type,
            center: { lat: parseFloat(result.lat), lon: parseFloat(result.lon) },
            display_name: result.display_name
          };
        })
        .filter(course => course !== null); // Remove null entries
      
      console.log(`Found ${courses.length} golf courses via Nominatim`);
      return courses;
      
    } catch (error) {
      console.error('Nominatim search failed, falling back to Overpass:', error);
      return await this.fallbackOverpassSearch(courseName, maxResults);
    }
  }
  
  /**
   * Fallback search using direct Overpass query
   */
  async fallbackOverpassSearch(courseName, maxResults = 10) {
    const searchQuery = `[out:json][timeout:30];
      (
        relation["golf"="course"]["name"~"${courseName}",i];
        way["golf"="course"]["name"~"${courseName}",i];
      );
      out center meta;`;
    
    try {
      const response = await fetch("https://overpass.kumi.systems/api/interpreter", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: "data=" + encodeURIComponent(searchQuery)
      });
      
      if (!response.ok) {
        throw new Error(`Overpass search failed: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Process results with correct area ID conversion
      const courses = data.elements
        .filter(element => element.tags && element.tags.name)
        .slice(0, maxResults)
        .map(element => {
          let courseId;
          if (element.type === 'relation') {
            courseId = (parseInt(element.id) + 3600000000).toString();
          } else if (element.type === 'way') {
            courseId = (parseInt(element.id) + 2400000000).toString();
          } else {
            return null;
          }
          
          return {
            id: courseId,
            name: element.tags.name,
            city: element.tags['addr:city'] || element.tags.city || '',
            state: element.tags['addr:state'] || element.tags.state || '',
            country: element.tags['addr:country'] || element.tags.country || '',
            type: element.type,
            center: element.center || (element.lat && element.lon ? {lat: element.lat, lon: element.lon} : null)
          };
        })
        .filter(course => course !== null);
      
      return courses;
    } catch (error) {
      console.error('Fallback Overpass search failed:', error);
      return [];
    }
  }

  /**
   * Fetch OSM data
   */
  async fetchOSMData(courseIds) {
    // Try area query first, then fallback to direct relation/way query
    console.log('Course ID being used:', courseIds);
    
    let query = `[out:json][timeout:60];
      area(id:${courseIds})->.a;
      (
        nwr["golf"](area.a);
        nwr["surface"="sand"](area.a);
        nwr["natural"="water"](area.a);
        nwr["waterway"](area.a);
        nwr["highway"="path"](area.a);
      );
      (._;>;);
      out geom;`;
      
    console.log('Trying area query first...');
    console.log('Overpass Query:', query);
      
    let response = await fetch("https://overpass.kumi.systems/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: "data=" + encodeURIComponent(query)
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.elements && data.elements.length > 0) {
        console.log(`Area query successful: found ${data.elements.length} elements`);
        return data;
      } else {
        console.log('Area query returned no elements, trying direct relation/way query...');
      }
    } else {
      console.log('Area query failed, trying direct relation/way query...');
    }
    
    // Fallback: Query the relation/way directly and search around it
    // Convert area ID back to relation/way ID
    let osmId, osmType;
    const areaId = parseInt(courseIds);
    if (areaId >= 3600000000) {
      osmId = areaId - 3600000000;
      osmType = 'relation';
    } else if (areaId >= 2400000000) {
      osmId = areaId - 2400000000;
      osmType = 'way';
    } else {
      throw new Error(`Invalid area ID format: ${courseIds}`);
    }
    
    console.log(`Fallback: Querying ${osmType} ${osmId} directly...`);
    
    query = `[out:json][timeout:60];
      ${osmType}(${osmId});
      out geom;
      (
        nwr["golf"](around:1000);
        nwr["surface"="sand"](around:1000);
        nwr["natural"="water"](around:1000);
        nwr["waterway"](around:1000);
        nwr["highway"="path"](around:1000);
      );
      (._;>;);
      out geom;`;
      
    console.log('Fallback Overpass Query:', query);
      
    response = await fetch("https://overpass.kumi.systems/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: "data=" + encodeURIComponent(query)
    });
    
    if (!response.ok) {
      console.error('Overpass API Error Response:', response.status, response.statusText);
      
      // Try to get the error details from the response
      try {
        const errorText = await response.text();
        console.error('Overpass Error Details:', errorText);
        throw new Error(`Failed to fetch OSM data: ${response.statusText}. Details: ${errorText}`);
      } catch (textError) {
        throw new Error(`Failed to fetch OSM data: ${response.statusText}`);
      }
    }
    
    const data = await response.json();
    console.log(`Fallback query successful: found ${data.elements ? data.elements.length : 0} elements`);
    return data;
  }

  /**
   * Convert OSM to GeoJSON (consider moving to worker)
   */
  async convertToGeoJSON(osmJson) {
    // This could be moved to a web worker for better performance
    return osmtogeojson(osmJson, { flatProperties: true });
  }

  /**
   * Process GeoJSON features in batches to prevent UI blocking
   */
  async processFeaturesInBatches(features, progressCallback = null) {
    const batchSize = 20; // Process 20 features at a time
    const totalFeatures = features.length;
    let processed = 0;
    
    const allCoords = [];
    
    for (let i = 0; i < totalFeatures; i += batchSize) {
      const batch = features.slice(i, Math.min(i + batchSize, totalFeatures));
      
      // Process batch
      for (const feature of batch) {
        await this.processFeature(feature, allCoords);
        processed++;
      }
      
      // Update progress
      if (progressCallback) {
        const progress = 0.4 + (processed / totalFeatures) * 0.4; // 40% to 80% of total
        progressCallback({
          phase: 'processing',
          progress,
          message: `Processed ${processed}/${totalFeatures} features`
        });
      }
      
      // Yield control to prevent blocking
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    
    // Create course boundary
    this.createCourseBoundary(allCoords);
    
    console.log(`Processed ${totalFeatures} course features`);
  }

  /**
   * Process a single feature
   */
  async processFeature(feature, allCoords) {
    const properties = feature.properties || {};
    const geometry = feature.geometry;
    
    if (!geometry || !geometry.coordinates) return;
    
    // Extract coordinates based on geometry type
    let coords = [];
    switch (geometry.type) {
      case "Polygon":
        coords = geometry.coordinates[0];
        break;
      case "MultiPolygon":
        coords = geometry.coordinates.flat(2);
        break;
      case "LineString":
        coords = geometry.coordinates;
        break;
      case "MultiLineString":
        coords = geometry.coordinates.flat();
        break;
      default:
        return;
    }
    
    if (coords.length === 0) return;
    
    // Add to all coordinates for boundary calculation
    allCoords.push(...coords);
    
    // Convert to Cesium format
    const cartesian3Array = Cesium.Cartesian3.fromDegreesArray(coords.flat());
    
    // Process based on feature type
    if (geometry.type.includes("Polygon")) {
      await this.processPolygonFeature(properties, cartesian3Array);
    } else if (geometry.type.includes("Line")) {
      await this.processLineFeature(properties, cartesian3Array);
    }
  }

  /**
   * Process polygon features (greens, bunkers, etc.)
   */
  async processPolygonFeature(properties, cartesian3Array) {
    let material = Cesium.Color.LAWNGREEN.withAlpha(0.15);
    let layer = null;
    
    if (properties.surface === "sand" || properties.natural === "sand") {
      material = Cesium.Color.SANDYBROWN.withAlpha(0.4);
      layer = this.layers.bunkers;
      this.courseFeatures.bunkers.push(cartesian3Array);
      
    } else if (properties.golf === "green") {
      material = Cesium.Color.LIMEGREEN.withAlpha(0.25);
      layer = this.layers.greens;
      this.courseFeatures.greens.push(cartesian3Array);
      
    } else if (properties.golf === "fairway") {
      material = Cesium.Color.GREEN.withAlpha(0.2);
      layer = this.layers.fairways;
      this.courseFeatures.fairways.push(cartesian3Array);
      
    } else if (properties.golf === "tee") {
      material = Cesium.Color.HONEYDEW.withAlpha(0.25);
      layer = this.layers.tees;
      this.courseFeatures.tees.push(cartesian3Array);
      
    } else if (properties.golf === "rough") {
      material = Cesium.Color.DARKOLIVEGREEN.withAlpha(0.3);
      layer = this.layers.roughs;
      this.courseFeatures.roughs.push(cartesian3Array);
      
    } else if (properties.natural === "water" || properties.waterway) {
      material = Cesium.Color.AQUAMARINE.withAlpha(0.3);
      layer = this.layers.water;
      this.courseFeatures.water.push(cartesian3Array);
      console.log('Processing water feature:', properties);
    }
    
    if (layer) {
      layer.entities.add({
        polygon: {
          hierarchy: cartesian3Array,
          clampToGround: true,
          material: material
        }
      });
    }
  }

  /**
   * Process line features (holes, cart paths)
   */
  async processLineFeature(properties, cartesian3Array) {
    // Cart paths
    if ((properties.golf === "cartpath" || properties.highway === "path")) {
      this.layers.cartpaths.entities.add({
        polyline: {
          positions: cartesian3Array,
          clampToGround: true,
          width: 2,
          material: Cesium.Color.LIGHTGRAY.withAlpha(0.6)
        }
      });
    }
    
    // Hole polylines
    if (properties.golf === "hole") {
      const ref = (properties.ref || properties.name || "").toString().trim();
      if (ref) {
        this.holeMap.set(ref, cartesian3Array);
        
        // Add to holes layer
        this.layers.holes.entities.add({
          polyline: {
            positions: cartesian3Array,
            clampToGround: true,
            width: 3,
            material: new Cesium.PolylineDashMaterialProperty({
              color: Cesium.Color.BLACK.withAlpha(0.7),
              dashLength: 8
            })
          }
        });
        
        // Add hole label
        const midpoint = cartesian3Array[Math.floor(cartesian3Array.length / 2)];
        this.layers.holelabels.entities.add({
          position: midpoint,
          label: {
            text: ref || "Hole",
            font: "16px sans-serif",
            fillColor: Cesium.Color.BLACK,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 1,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
          }
        });
      }
    }
  }

  /**
   * Create course boundary (normal rough + OB)
   */
  createCourseBoundary(allCoords) {
    if (allCoords.length === 0) return;
    
    const lons = allCoords.map(c => c[0]);
    const lats = allCoords.map(c => c[1]);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    
    const buffer = 0.0001;
    const corners = [
      [minLon - buffer, minLat - buffer],
      [minLon - buffer, maxLat + buffer],
      [maxLon + buffer, maxLat + buffer],
      [maxLon + buffer, minLat - buffer]
    ];
    
    const cartCorners = Cesium.Cartesian3.fromDegreesArray(corners.flat());
    
    // Normal rough background - DISABLED to prevent interference with course feature detection
    // this.layers.normalrough.entities.add({
    //   polygon: {
    //     hierarchy: cartCorners,
    //     clampToGround: true,
    //     material: Cesium.Color.fromCssColorString("#006747").withAlpha(0.1)
    //   }
    // });
    
    // OB boundary
    this.layers.ob.entities.add({
      polyline: {
        positions: [...cartCorners, cartCorners[0]],
        clampToGround: true,
        width: 3,
        material: Cesium.Color.RED.withAlpha(0.8)
      }
    });
    
    // Store boundary for camera framing
    this.courseBounds = Cesium.Rectangle.fromDegrees(minLon, minLat, maxLon, maxLat);
  }

  /**
   * Optimized green and tee matching using spatial proximity
   */
  async matchGreensAndTees() {
    console.log('Matching greens and tees to holes...');
    
    // Match greens to holes
    for (const [holeNum, holePath] of this.holeMap.entries()) {
      if (!holePath || holePath.length === 0) continue;
      
      // Find closest green
      let closestGreen = null;
      let minDistance = Infinity;
      
      for (const greenPoly of this.courseFeatures.greens) {
        const distance = this.calculatePolylineToPolygonDistance(holePath, greenPoly);
        if (distance < minDistance) {
          minDistance = distance;
          closestGreen = greenPoly;
        }
      }
      
      if (closestGreen && minDistance < 50) { // Within 50 meters
        this.greenMap.set(holeNum, closestGreen);
      }
      
      // Find closest tee
      let closestTee = null;
      minDistance = Infinity;
      
      for (const teePoly of this.courseFeatures.tees) {
        const distance = this.calculatePolylineToPolygonDistance(holePath, teePoly);
        if (distance < minDistance) {
          minDistance = distance;
          closestTee = teePoly;
        }
      }
      
      if (closestTee && minDistance < 50) { // Within 50 meters
        this.teeMap.set(holeNum, closestTee);
      }
    }
    
    console.log(`Matched ${this.greenMap.size} greens and ${this.teeMap.size} tees to holes`);
    
    // Match bunkers to holes
    for (const [holeNum, holePath] of this.holeMap.entries()) {
      if (!holePath || holePath.length === 0) continue;
      
      const nearbyBunkers = [];
      for (const bunker of this.courseFeatures.bunkers) {
        const distance = this.calculateMinDistance(holePath, bunker);
        if (distance < 200) { // Within 200 meters of hole path
          nearbyBunkers.push(bunker);
        }
      }
      
      if (nearbyBunkers.length > 0) {
        this.bunkerMap.set(holeNum, nearbyBunkers);
      }
    }
    
    // Match water hazards to holes
    for (const [holeNum, holePath] of this.holeMap.entries()) {
      if (!holePath || holePath.length === 0) continue;
      
      const nearbyWater = [];
      for (const water of this.courseFeatures.water) {
        const distance = this.calculateMinDistance(holePath, water);
        if (distance < 300) { // Within 300 meters of hole path
          nearbyWater.push(water);
        }
      }
      
      if (nearbyWater.length > 0) {
        this.waterMap.set(holeNum, nearbyWater);
      }
    }
    
    console.log(`Matched ${this.bunkerMap.size} holes with bunkers and ${this.waterMap.size} holes with water hazards`);
  }

  /**
   * Calculate minimum distance between polyline (hole path) and polygon (feature)
   */
  calculateMinDistance(polyline, polygon) {
    if (!polyline || !polygon || polyline.length === 0 || polygon.length === 0) {
      return Infinity;
    }
    
    let minDistance = Infinity;
    
    // Check distance from each point in polyline to each point in polygon
    for (const linePoint of polyline) {
      for (const polyPoint of polygon) {
        const distance = Cesium.Cartesian3.distance(linePoint, polyPoint);
        minDistance = Math.min(minDistance, distance);
      }
    }
    
    return minDistance;
  }

  /**
   * Calculate minimum distance between polyline and polygon
   */
  calculatePolylineToPolygonDistance(polyline, polygon) {
    let minDistance = Infinity;
    
    for (const linePoint of polyline) {
      for (const polyPoint of polygon) {
        const distance = Cesium.Cartesian3.distance(linePoint, polyPoint);
        if (distance < minDistance) {
          minDistance = distance;
        }
      }
    }
    
    return minDistance;
  }

  /**
   * Set initial camera view
   */
  async setInitialView() {
    if (this.courseBounds) {
      await this.viewer.camera.flyTo({
        destination: this.courseBounds,
        duration: 1.0
      });
    }
  }

  /**
   * Toggle course features visibility
   */
  toggleFeatureVisibility(visible) {
    const toggleableFeatures = ['greens', 'fairways', 'tees', 'bunkers', 'roughs', 'water', 'normalrough', 'holelabels', 'cartpaths', 'ob'];
    
    toggleableFeatures.forEach(layerName => {
      if (this.layers[layerName]) {
        this.layers[layerName].show = visible;
      }
    });
  }

  /**
   * Get course features for analysis
   */
  getCourseFeatures() {
    return {
      ...this.courseFeatures,
      holeMap: this.holeMap,
      greenMap: this.greenMap,
      teeMap: this.teeMap,
      bunkerMap: this.bunkerMap,
      waterMap: this.waterMap
    };
  }

  /**
   * Download the raw GeoJSON data for inspection
   */
  downloadGeoJSON() {
    if (!this.currentGeoJSON) {
      console.warn('No GeoJSON data available');
      return;
    }
    
    const dataStr = JSON.stringify(this.currentGeoJSON, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `course_${Date.now()}.geojson`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    console.log('GeoJSON downloaded');
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    // Clear all data sources
    for (const dataSource of Object.values(this.layers)) {
      this.viewer.dataSources.remove(dataSource);
    }
    
    // Clear maps
    this.holeMap.clear();
    this.greenMap.clear();
    this.teeMap.clear();
    
    console.log('Course Data Manager: Cleanup completed');
  }
}

// Export for use in main application
window.CourseDataManager = CourseDataManager;