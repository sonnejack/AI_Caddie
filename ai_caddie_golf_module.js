/**
 * AI-Caddie Golf Analysis Module v2
 * 
 * Comprehensive golf course visualization and shot analysis system using Cesium.js
 * Extracted from slope_oval_geojson_optimized.html
 * 
 * Features:
 * - Expected strokes calculations with embedded polynomial coefficients
 * - Course feature detection with spatial caching
 * - Dispersion oval and roll oval generation with dual-oval system
 * - Shot type analysis (tee vs approach shots)
 * - Aim point optimization algorithms
 * - Camera positioning and navigation
 * - Terrain sampling and elevation calculations
 * - UI controls and event handling
 */

class AICaddieGolfModule {
  constructor(viewer, courseDataManager) {
    this.viewer = viewer;
    this.courseDataManager = courseDataManager;
    
    // Initialize core properties
    this.initializeProperties();
    
    // Set up event handlers
    this.setupEventHandlers();
    
    console.log('AI-Caddie Golf Module initialized');
    
    // Load short game modifiers
    this.loadShortGameModifiers();
  }

  // ==================== INITIALIZATION ====================
  
  initializeProperties() {
    // Cesium and course data
    this.viewer = null;
    this.courseDataManager = null;
    this.courseFeatures = {};
    
    // Slope visualization
    this.slopeArrowDS = new Cesium.CustomDataSource("slopeArrows");
    this.viewer.dataSources.add(this.slopeArrowDS);
    this.slopeDots = this.viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
    
    // Hole navigation state
    this.currentHoleId = null;
    this.currentHolePath = null;
    this.currentGreenPoly = null;
    this.currentHoleLength = 0;
    
    // Shot type and positioning
    this.currentShotType = 'tee'; // 'tee' or 'approach'
    this.centerLon = 0;
    this.centerLat = 0;
    
    // Oval dimensions and roll system
    this.ovalWidth = 25; // Default width in meters
    this.ovalDepth = 15; // Default depth in meters
    this.rollCondition = 'no'; // 'no', 'soft', 'medium', 'firm', 'very-firm'
    this.rollOvalEntity = null;
    
    // Entities
    this.ovalEntity = null;
    this.centerPointEntity = null;
    this.pinEntity = null;
    this.launchEntity = null;
    this.sampleEntities = [];
    
    // Selection states
    this.selectingOval = false;
    this.selectingPin = false;
    this.selectingLaunch = false;
    
    // Performance optimization
    this.lastSamplePosition = { lon: 0, lat: 0, width: 0, depth: 0 };
    this.courseFeatureCache = null;
    this.currentCachedHoleId = null;
    this.sizingFromSkill = false;
    
    // Optimization system
    this.optimizationInProgress = false;
    this.optimizationCandidates = [];
    this.candidateEntities = [];
    this.maxDriveDistance = 274.32; // 300 yards in meters
    
    // User-defined course conditions
    this.userDefinedConditions = {
      water: [], bunkers: [], greens: [], tees: [], fairways: [],
      roughs: [], hazards: [], ob: [], recovery: []
    };
    
    // Advanced short game system
    this.advancedModeEnabled = false;
    this.shortGameModifiers = null;
    
    // Drawing state
    this.currentDrawingType = null;
    this.currentPolygonPoints = [];
    this.drawingPolygonEntity = null;
    this.conditionHistory = [];
    this.conditionEntities = [];
    
    // Constants
    this.SKILL_LEVELS = {
      pro: { offlineDeg: 5.3, distPct: 0.037 },
      elite: { offlineDeg: 5.9, distPct: 0.044 },
      scratch: { offlineDeg: 6.4, distPct: 0.049 },
      good: { offlineDeg: 6.9, distPct: 0.055 },
      average: { offlineDeg: 7.7, distPct: 0.061 },
      bad: { offlineDeg: 11.2, distPct: 0.072 },
      terrible: { offlineDeg: 14, distPct: 0.084 }
    };
    
    this.metersPerDegLat = 110574.2727;
    this.metersPerDegLonAt = lat => 111319.490793 * Math.cos(lat * Math.PI / 180);
    this.POSITION_THRESHOLD_METERS = 5;
    this.DEBUG_MODE = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');
  }

  // ==================== CESIUM INITIALIZATION ====================
  
  static async initializeCesium(containerId, ionToken) {
    // Set Cesium Ion token
    Cesium.Ion.defaultAccessToken = ionToken;
    
    // Create viewer with terrain
    const viewer = new Cesium.Viewer(containerId, {
      terrainProvider: await Cesium.CesiumTerrainProvider.fromIonAssetId(1),
      baseLayerPicker: false,
      sceneModePicker: false,
      animation: false,
      timeline: false,
      selectionIndicator: false,
      infoBox: false
    });

    // Disable entity selection behavior
    viewer.selectedEntity = undefined;
    viewer.trackedEntity = undefined;
    
    // Prevent any future selections by immediately clearing them
    viewer.selectedEntityChanged.addEventListener(() => {
      if (viewer.selectedEntity) {
        viewer.selectedEntity = undefined;
      }
    });
    
    // Prevent camera tracking
    viewer.trackedEntityChanged.addEventListener(() => {
      if (viewer.trackedEntity) {
        viewer.trackedEntity = undefined;
      }
    });
    
    return viewer;
  }

  // ==================== EXPECTED STROKES CALCULATIONS ====================
  
  /**
   * Calculate expected strokes using embedded 6th degree polynomial coefficients
   * @param {number} distanceYards - Distance in yards
   * @param {string} courseFeature - Course feature type
   * @returns {number|null} Expected strokes or null if invalid
   */
  calculateExpectedStrokes(distanceYards, courseFeature) {
    const x = distanceYards;
    let strokes;
    
    // Don't calculate for distances less than 0 or greater than 600 yards
    if (x < 0 || x > 600) {
      return null;
    }
    
    switch (courseFeature) {
      case 'fairway':
      case 'tee': // Tee expected strokes same as fairway
        if (x < 7.43) {
          // Linear extrapolation from (0, 1) to first point
          const firstY = 1.87505684 + 3.44179367e-02 * 7.43 + -5.63306650e-04 * Math.pow(7.43, 2) + 4.70425536e-06 * Math.pow(7.43, 3) + -2.02041273e-08 * Math.pow(7.43, 4) + 4.38015739e-11 * Math.pow(7.43, 5) + -3.78163505e-14 * Math.pow(7.43, 6);
          const slope = (firstY - 1.0) / (7.43 - 0);
          strokes = 1.0 + slope * x;
        } else if (x <= 348.9) {
          // Degree 6 polynomial (fitted coefficients)
          strokes = 1.87505684 + 3.44179367e-02 * x + -5.63306650e-04 * Math.pow(x, 2) + 4.70425536e-06 * Math.pow(x, 3) + -2.02041273e-08 * Math.pow(x, 4) + 4.38015739e-11 * Math.pow(x, 5) + -3.78163505e-14 * Math.pow(x, 6);
        } else {
          // Linear extrapolation from last point to (600, 5.25)
          const lastY = 1.87505684 + 3.44179367e-02 * 348.9 + -5.63306650e-04 * Math.pow(348.9, 2) + 4.70425536e-06 * Math.pow(348.9, 3) + -2.02041273e-08 * Math.pow(348.9, 4) + 4.38015739e-11 * Math.pow(348.9, 5) + -3.78163505e-14 * Math.pow(348.9, 6);
          const slope = (5.25 - lastY) / (600 - 348.9);
          strokes = lastY + slope * (x - 348.9);
        }
        break;
        
      case 'rough':
        if (x < 7.76) {
          // Linear extrapolation from (0, 1.5) to first point
          const firstY = 2.01325284 + 3.73834464e-02 * 7.76 + -6.08542541e-04 * Math.pow(7.76, 2) + 5.01193038e-06 * Math.pow(7.76, 3) + -2.08847962e-08 * Math.pow(7.76, 4) + 4.32228049e-11 * Math.pow(7.76, 5) + -3.53899274e-14 * Math.pow(7.76, 6);
          const slope = (firstY - 1.5) / (7.76 - 0);
          strokes = 1.5 + slope * x;
        } else if (x <= 348.9) {
          // Degree 6 polynomial (fitted coefficients)
          strokes = 2.01325284 + 3.73834464e-02 * x + -6.08542541e-04 * Math.pow(x, 2) + 5.01193038e-06 * Math.pow(x, 3) + -2.08847962e-08 * Math.pow(x, 4) + 4.32228049e-11 * Math.pow(x, 5) + -3.53899274e-14 * Math.pow(x, 6);
        } else {
          // Linear extrapolation from last point to (600, 5.4)
          const lastY = 2.01325284 + 3.73834464e-02 * 348.9 + -6.08542541e-04 * Math.pow(348.9, 2) + 5.01193038e-06 * Math.pow(348.9, 3) + -2.08847962e-08 * Math.pow(348.9, 4) + 4.32228049e-11 * Math.pow(348.9, 5) + -3.53899274e-14 * Math.pow(348.9, 6);
          const slope = (5.4 - lastY) / (600 - 348.9);
          strokes = lastY + slope * (x - 348.9);
        }
        break;
        
      case 'sand':
        if (x < 7.96) {
          // Linear extrapolation from (0, 2) to first point
          const firstY = 2.14601649 + 2.61044155e-02 * 7.96 + -2.69537153e-04 * Math.pow(7.96, 2) + 1.48010114e-06 * Math.pow(7.96, 3) + -3.99813977e-09 * Math.pow(7.96, 4) + 5.24740763e-12 * Math.pow(7.96, 5) + -2.67577455e-15 * Math.pow(7.96, 6);
          const slope = (firstY - 2.0) / (7.96 - 0);
          strokes = 2.0 + slope * x;
        } else {
          // Degree 6 polynomial (fitted coefficients, valid 0-600)
          strokes = 2.14601649 + 2.61044155e-02 * x + -2.69537153e-04 * Math.pow(x, 2) + 1.48010114e-06 * Math.pow(x, 3) + -3.99813977e-09 * Math.pow(x, 4) + 5.24740763e-12 * Math.pow(x, 5) + -2.67577455e-15 * Math.pow(x, 6);
        }
        break;
        
      case 'recovery':
        if (x < 100) {
          // Linear extrapolation from (0, 3) to first point
          const firstY = 1.34932958 + 6.39685426e-02 * 100 + -6.38754410e-04 * Math.pow(100, 2) + 3.09148159e-06 * Math.pow(100, 3) + -7.60396073e-09 * Math.pow(100, 4) + 9.28546297e-12 * Math.pow(100, 5) + -4.46945896e-15 * Math.pow(100, 6);
          const slope = (firstY - 3.0) / (100 - 0);
          strokes = 3.0 + slope * x;
        } else {
          // Degree 6 polynomial (fitted coefficients, valid 100-600)
          strokes = 1.34932958 + 6.39685426e-02 * x + -6.38754410e-04 * Math.pow(x, 2) + 3.09148159e-06 * Math.pow(x, 3) + -7.60396073e-09 * Math.pow(x, 4) + 9.28546297e-12 * Math.pow(x, 5) + -4.46945896e-15 * Math.pow(x, 6);
        }
        break;
        
      case 'water':
        // Water hazard - penalty stroke + rough formula
        let roughStrokes;
        if (x < 7.76) {
          const firstY = 2.01325284 + 3.73834464e-02 * 7.76 + -6.08542541e-04 * Math.pow(7.76, 2) + 5.01193038e-06 * Math.pow(7.76, 3) + -2.08847962e-08 * Math.pow(7.76, 4) + 4.32228049e-11 * Math.pow(7.76, 5) + -3.53899274e-14 * Math.pow(7.76, 6);
          const slope = (firstY - 1.5) / (7.76 - 0);
          roughStrokes = 1.5 + slope * x;
        } else if (x <= 348.9) {
          roughStrokes = 2.01325284 + 3.73834464e-02 * x + -6.08542541e-04 * Math.pow(x, 2) + 5.01193038e-06 * Math.pow(x, 3) + -2.08847962e-08 * Math.pow(x, 4) + 4.32228049e-11 * Math.pow(x, 5) + -3.53899274e-14 * Math.pow(x, 6);
        } else {
          const lastY = 2.01325284 + 3.73834464e-02 * 348.9 + -6.08542541e-04 * Math.pow(348.9, 2) + 5.01193038e-06 * Math.pow(348.9, 3) + -2.08847962e-08 * Math.pow(348.9, 4) + 4.32228049e-11 * Math.pow(348.9, 5) + -3.53899274e-14 * Math.pow(348.9, 6);
          const slope = (5.4 - lastY) / (600 - 348.9);
          roughStrokes = lastY + slope * (x - 348.9);
        }
        strokes = roughStrokes + 1.0; // Add penalty stroke
        break;
        
      case 'green':
        if (x < 0.333) {
          strokes = 1.001;
        } else if (x <= 33.39) {
          // Degree 6 polynomial for putting (0.33-33.39 yards)
          strokes = 8.22701978e-01 + 3.48808959e-01 * x + -4.45111801e-02 * Math.pow(x, 2) + 3.05771434e-03 * Math.pow(x, 3) + -1.12243654e-04 * Math.pow(x, 4) + 2.09685358e-06 * Math.pow(x, 5) + -1.57305673e-08 * Math.pow(x, 6);
        } else {
          // For green distances > 33.39 yards, treat as fairway
          return this.calculateExpectedStrokes(x, 'fairway');
        }
        break;
        
      default:
        // Default to rough if feature unknown
        return this.calculateExpectedStrokes(x, 'rough');
    }
    
    // Enforce minimum of 1.001 strokes (never allow values under 1)
    return Math.max(1.001, strokes);
  }

  /**
   * Enhanced expected strokes calculation with user-defined penalties
   */
  calculateExpectedStrokesWithPenalties(distanceYards, lon, lat) {
    try {
      // Check user-defined conditions in priority order
      
      // First check if point is in currently-being-drawn polygon (if it has 3+ points)
      if (this.currentDrawingType && this.currentPolygonPoints.length >= 3) {
        const drawingPolygon = this.currentPolygonPoints.map(p => [p.lon, p.lat]);
        if (this.isPointInPolygon(lon, lat, drawingPolygon)) {
          // Handle special penalty conditions for currently-being-drawn polygon
          if (this.currentDrawingType === 'hazards') {
            const roughStrokes = this.calculateExpectedStrokes(distanceYards, 'rough');
            return roughStrokes + 1; // Hazard penalty
          } else if (this.currentDrawingType === 'ob') {
            const roughStrokes = this.calculateExpectedStrokes(distanceYards, 'rough');
            return roughStrokes + 2; // OB penalty
          } else {
            // Map drawing type to expected strokes calculation
            let featureType = this.currentDrawingType;
            if (this.currentDrawingType === 'bunkers') featureType = 'sand';
            if (this.currentDrawingType === 'greens') featureType = 'green';
            if (this.currentDrawingType === 'fairways') featureType = 'fairway';
            if (this.currentDrawingType === 'roughs') featureType = 'rough';
            if (this.currentDrawingType === 'tees') featureType = 'tee';
            if (this.currentDrawingType === 'water') featureType = 'water';
            if (this.currentDrawingType === 'recovery') featureType = 'recovery';
            
            return this.calculateExpectedStrokes(distanceYards, featureType);
          }
        }
      }
      
      // Then check for completed user-defined course conditions (override natural features)
      for (const [conditionType, polygons] of Object.entries(this.userDefinedConditions)) {
        if (polygons && Array.isArray(polygons)) {
          for (const polygon of polygons) {
            if (this.isPointInPolygon(lon, lat, polygon)) {
              // Handle special penalty conditions
              if (conditionType === 'hazards') {
                const roughStrokes = this.calculateExpectedStrokes(distanceYards, 'rough');
                return roughStrokes + 1; // Hazard penalty
              } else if (conditionType === 'ob') {
                const roughStrokes = this.calculateExpectedStrokes(distanceYards, 'rough');
                return roughStrokes + 2; // OB penalty
              } else {
                // Map condition type to expected strokes calculation
                let featureType = conditionType;
                if (conditionType === 'bunkers') featureType = 'sand';
                if (conditionType === 'greens') featureType = 'green';
                if (conditionType === 'fairways') featureType = 'fairway';
                if (conditionType === 'roughs') featureType = 'rough';
                if (conditionType === 'tees') featureType = 'tee';
                if (conditionType === 'water') featureType = 'water';
                if (conditionType === 'recovery') featureType = 'recovery';
                
                return this.calculateExpectedStrokes(distanceYards, featureType);
              }
            }
          }
        }
      }
      
      // If not in any user-defined area, use natural course feature detection
      const courseFeature = this.identifyCourseFeature(lon, lat);
      return this.calculateExpectedStrokes(distanceYards, courseFeature);
      
    } catch (error) {
      console.warn('Error calculating expected strokes with penalties:', error);
      // Fallback to basic calculation
      const courseFeature = this.identifyCourseFeature(lon, lat);
      return this.calculateExpectedStrokes(distanceYards, courseFeature);
    }
  }

  // ==================== COURSE FEATURE DETECTION ====================
  
  /**
   * Build spatial cache for course feature detection (performance optimization)
   */
  buildCourseFeatureCache(holeId) {
    if (this.currentCachedHoleId === holeId && this.courseFeatureCache) {
      return this.courseFeatureCache; // Use existing cache
    }
    
    console.log(`Building spatial cache for hole ${holeId}...`);
    
    const cache = {
      waterPolygons: [],
      bunkerPolygons: [],
      teePolygons: [],
      fairwayPolygons: [],
      greenPolygon: null,
      holeId: holeId
    };
    
    // Pre-convert water hazards to degree coordinates (avoid repeated conversion)
    if (this.courseFeatures && this.courseFeatures.waterMap && holeId) {
      const waterHazards = this.courseFeatures.waterMap.get(String(holeId));
      if (waterHazards) {
        for (const water of waterHazards) {
          const degreeCoords = water.map(p => this.cartToDeg(p).slice(0, 2));
          cache.waterPolygons.push(degreeCoords);
        }
      }
    }
    
    // Pre-convert bunkers to degree coordinates
    if (this.courseFeatures && this.courseFeatures.bunkerMap && holeId) {
      const bunkers = this.courseFeatures.bunkerMap.get(String(holeId));
      if (bunkers) {
        for (const bunker of bunkers) {
          const degreeCoords = bunker.map(p => this.cartToDeg(p).slice(0, 2));
          cache.bunkerPolygons.push(degreeCoords);
        }
      }
    }
    
    // Add ALL tee polygons to cache - shots can land on any tee on the course
    if (this.courseDataManager && this.courseDataManager.courseFeatures) {
      const allTees = this.courseDataManager.courseFeatures.tees;
      if (allTees) {
        console.log(`Loading ALL ${allTees.length} tees for detection (no distance filtering)...`);
        for (const tee of allTees) {
          const degreeCoords = tee.map(p => this.cartToDeg(p).slice(0, 2));
          cache.teePolygons.push(degreeCoords);
        }
        console.log(`Added ${cache.teePolygons.length} tee polygons to cache`);
      }
    }
    
    // Add ALL fairway polygons to cache - shots can land on any fairway on the course
    if (this.courseDataManager && this.courseDataManager.courseFeatures) {
      const allFairways = this.courseDataManager.courseFeatures.fairways;
      if (allFairways) {
        console.log(`Loading ALL ${allFairways.length} fairways for detection (no distance filtering)...`);
        for (const fairway of allFairways) {
          const degreeCoords = fairway.map(p => this.cartToDeg(p).slice(0, 2));
          cache.fairwayPolygons.push(degreeCoords);
        }
        console.log(`Added ${cache.fairwayPolygons.length} fairway polygons to cache`);
      }
    }
    
    // Add individual rough polygons to cache (NOT the blanket background)
    if (this.courseDataManager && this.courseDataManager.courseFeatures) {
      const allRoughs = this.courseDataManager.courseFeatures.roughs;
      if (allRoughs) {
        console.log(`Loading ${allRoughs.length} individual rough areas for detection...`);
        for (const rough of allRoughs) {
          const degreeCoords = rough.map(p => this.cartToDeg(p).slice(0, 2));
          if (!cache.roughPolygons) cache.roughPolygons = [];
          cache.roughPolygons.push(degreeCoords);
        }
        console.log(`Added ${cache.roughPolygons ? cache.roughPolygons.length : 0} rough polygons to cache`);
      }
    }
    
    // Convert green polygon to degree coordinates for consistent detection
    if (this.currentGreenPoly) {
      try {
        const degreeCoords = this.currentGreenPoly.map(p => this.cartToDeg(p).slice(0, 2));
        cache.greenPolygon = degreeCoords;
        console.log(`Added green polygon with ${degreeCoords.length} points to cache`);
      } catch (error) {
        console.warn('Error converting green polygon:', error);
        cache.greenPolygon = null;
      }
    }
    
    this.courseFeatureCache = cache;
    this.currentCachedHoleId = holeId;
    console.log(`Spatial cache built: ${cache.waterPolygons.length} water, ${cache.bunkerPolygons.length} bunkers, ${cache.teePolygons.length} tees, ${cache.fairwayPolygons.length} fairways, ${cache.roughPolygons ? cache.roughPolygons.length : 0} roughs`);
    
    return cache;
  }

  /**
   * Identify course feature at given coordinates using spatial cache
   */
  identifyCourseFeature(lon, lat) {
    try {
      // Build/get spatial cache for current hole
      const cache = this.buildCourseFeatureCache(this.currentHoleId);
      
      // Priority order: water, bunker, green, tee, fairway, rough
      
      // Check water hazards first (using pre-converted coordinates)
      for (const waterPoly of cache.waterPolygons) {
        if (this.pointInPolyDeg(lon, lat, waterPoly)) {
          return 'water';
        }
      }
      
      // Check bunkers (using pre-converted coordinates)  
      for (const bunkerPoly of cache.bunkerPolygons) {
        if (this.pointInPolyDeg(lon, lat, bunkerPoly)) {
          return 'sand';
        }
      }
      
      // Check if point is in green - third priority
      if (cache.greenPolygon) {
        if (this.pointInPolyDeg(lon, lat, cache.greenPolygon)) {
          console.log(`Point (${lon.toFixed(6)}, ${lat.toFixed(6)}) detected as GREEN`);
          return 'green';
        }
      }
      
      // Check tee polygons - fourth priority
      for (let i = 0; i < cache.teePolygons.length; i++) {
        const teePoly = cache.teePolygons[i];
        if (this.pointInPolyDeg(lon, lat, teePoly)) {
          console.log(`Point (${lon.toFixed(6)}, ${lat.toFixed(6)}) detected as TEE (polygon ${i})`);
          return 'tee';
        }
      }
      
      // Check fairway polygons - fifth priority
      for (let i = 0; i < cache.fairwayPolygons.length; i++) {
        const fairwayPoly = cache.fairwayPolygons[i];
        if (this.pointInPolyDeg(lon, lat, fairwayPoly)) {
          console.log(`Point (${lon.toFixed(6)}, ${lat.toFixed(6)}) detected as FAIRWAY (polygon ${i})`);
          return 'fairway';
        }
      }
      
      // Check individual rough polygons - sixth priority (only specific rough areas, not blanket)
      if (cache.roughPolygons) {
        for (let i = 0; i < cache.roughPolygons.length; i++) {
          const roughPoly = cache.roughPolygons[i];
          if (this.pointInPolyDeg(lon, lat, roughPoly)) {
            console.log(`Point (${lon.toFixed(6)}, ${lat.toFixed(6)}) detected as ROUGH (polygon ${i})`);
            return 'rough';
          }
        }
      }
      
      // If not in any specific area, default to rough
      console.log(`Point (${lon.toFixed(6)}, ${lat.toFixed(6)}) not in any specific area - defaulting to ROUGH`);
      return 'rough';
    } catch (error) {
      console.warn('Error identifying course feature:', error);
      return 'rough'; // Safe fallback
    }
  }

  // ==================== DISPERSION OVAL GENERATION ====================
  
  /**
   * Generate ellipse coordinates in lon/lat degrees
   */
  ellipseLonLatArray(lonDeg, latDeg, semiMajor, semiMinor, rotRad, segments = 128) {
    const arr = [];
    const cosR = Math.cos(rotRad), sinR = Math.sin(rotRad);
    const mPerLon = this.metersPerDegLonAt(latDeg);
    for (let i = 0; i <= segments; i++) {
      const th = 2 * Math.PI * i / segments;
      const x = semiMajor * Math.cos(th);
      const y = semiMinor * Math.sin(th);
      const xr = x * cosR - y * sinR;
      const yr = x * sinR + y * cosR;
      arr.push(lonDeg + xr / mPerLon, latDeg + yr / this.metersPerDegLat);
    }
    return arr;
  }

  /**
   * Generate random point inside ellipse
   */
  randomPointInEllipse(semiMajor, semiMinor) {
    const r = Math.sqrt(Math.random());
    const th = 2 * Math.PI * Math.random();
    return { x: r * semiMajor * Math.cos(th), y: r * semiMinor * Math.sin(th) };
  }

  /**
   * Check if point is inside ellipse
   */
  isPointInEllipse(lon, lat, centerLon, centerLat, semiMajor, semiMinor, rotRad) {
    const mPerLon = this.metersPerDegLonAt(centerLat);
    
    // Transform point to ellipse local coordinates
    const dx = (lon - centerLon) * mPerLon;
    const dy = (lat - centerLat) * this.metersPerDegLat;
    
    // Rotate to align with ellipse axes
    const cosR = Math.cos(-rotRad);
    const sinR = Math.sin(-rotRad);
    const x = dx * cosR - dy * sinR;
    const y = dx * sinR + dy * cosR;
    
    // Check if point is inside ellipse
    return (x * x) / (semiMajor * semiMajor) + (y * y) / (semiMinor * semiMinor) <= 1.0;
  }

  /**
   * Rebuild dispersion oval with current parameters
   */
  rebuildOval() {
    if (this.centerLon === 0 && this.centerLat === 0) return; // No center set yet
    
    // Use global variables for dispersion oval dimensions
    const w = this.ovalWidth;
    const d = this.ovalDepth;
    const userRot = 0; // Default rotation
    const rotDeg = ((360 - this.getBaseHeadingDeg()) + userRot) % 360;
    const semiMajor = Math.max(w, d) / 2;
    const semiMinor = Math.min(w, d) / 2;
    const rotRad = Cesium.Math.toRadians(rotDeg);

    if (this.ovalEntity) this.viewer.entities.remove(this.ovalEntity);
    if (this.centerPointEntity) this.viewer.entities.remove(this.centerPointEntity);

    const lonLatArr = this.ellipseLonLatArray(this.centerLon, this.centerLat, semiMajor, semiMinor, rotRad);
    
    // Create oval with proper ground clamping
    this.ovalEntity = this.viewer.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(lonLatArr),
        width: 4,
        material: Cesium.Color.RED,
        clampToGround: true,
        classificationType: Cesium.ClassificationType.TERRAIN // Ensure it clamps to terrain, not 3D tiles
      }
    });

    // center marker with consistent clamping
    this.centerPointEntity = this.viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(this.centerLon, this.centerLat),
      point: { 
        pixelSize: 5, 
        color: Cesium.Color.RED, 
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: 1000
      }
    });
    
    // Create roll oval if roll conditions are enabled
    this.createRollOval();
    
    // Generate sample points for the new oval
    this.generateRandomPoints();
    
    // Force a scene render to ensure clamping is applied
    this.viewer.scene.requestRender();
  }

  // ==================== ROLL SYSTEM ====================
  
  /**
   * Get roll multipliers for different conditions
   */
  getRollMultipliers(condition) {
    switch (condition) {
      case 'soft':
        return { widthMultiplier: 1.05, depthMultiplier: 1.4 };
      case 'medium':
        return { widthMultiplier: 1.1, depthMultiplier: 1.8 };
      case 'firm':
        return { widthMultiplier: 1.15, depthMultiplier: 2.2 };
      case 'very-firm':
        return { widthMultiplier: 1.2, depthMultiplier: 2.6 };
      default: // 'no'
        return { widthMultiplier: 1.0, depthMultiplier: 1.0 };
    }
  }

  /**
   * Create roll oval visualization with proper overlap positioning
   */
  createRollOval() {
    if (this.rollCondition === 'no') {
      if (this.rollOvalEntity) {
        this.viewer.entities.remove(this.rollOvalEntity);
        this.rollOvalEntity = null;
      }
      return null;
    }

    const { widthMultiplier, depthMultiplier } = this.getRollMultipliers(this.rollCondition);
    
    // Calculate roll oval dimensions
    const rollWidth = this.ovalWidth * widthMultiplier;
    const rollDepth = this.ovalDepth * depthMultiplier;
    
    // Calculate offset so roll oval's closest point coincides with dispersion oval's closest point
    const originalSemiDepth = this.ovalDepth / 2;  // Half-depth of original oval
    const rollSemiDepth = rollDepth / 2;      // Half-depth of roll oval
    
    // Offset = difference in semi-depths (positive = forward toward target)
    const offset = rollSemiDepth - originalSemiDepth;
    
    // Calculate heading from starting position to target
    const baseHeading = this.getBaseHeadingDeg();
    console.log(`Base heading from starting position to target: ${baseHeading.toFixed(1)}°`);
    
    // Use the direct heading without transformation for offset calculation
    const headingRad = Cesium.Math.toRadians(baseHeading);
    const mPerLon = this.metersPerDegLonAt(this.centerLat);
    
    // Offset in direction of target (forward from dispersion oval center)
    const offsetX = offset * Math.sin(headingRad);
    const offsetY = offset * Math.cos(headingRad);
    
    console.log(`Roll offset: ${offset}m at heading ${baseHeading.toFixed(1)}° → dx=${offsetX.toFixed(2)}m, dy=${offsetY.toFixed(2)}m`);
    
    const rollCenterLon = this.centerLon + offsetX / mPerLon;
    const rollCenterLat = this.centerLat + offsetY / this.metersPerDegLat;
    
    console.log(`Roll positioning: original semi-depth=${originalSemiDepth}m, roll semi-depth=${rollSemiDepth}m, offset=${offset}m (overlap positioning)`);
    
    // Create roll oval geometry (use same rotation formula as dispersion oval)
    const rollSemiMajor = Math.max(rollWidth, rollDepth) / 2;
    const rollSemiMinor = Math.min(rollWidth, rollDepth) / 2;
    const rollRotDeg = ((360 - this.getBaseHeadingDeg()) + 0) % 360; // Same as dispersion oval
    const rollRotRad = Cesium.Math.toRadians(rollRotDeg);
    const rollLonLatArr = this.ellipseLonLatArray(rollCenterLon, rollCenterLat, rollSemiMajor, rollSemiMinor, rollRotRad);
    
    console.log(`Roll rotation: ${rollRotDeg.toFixed(1)}° (same as dispersion oval)`);
    
    // Remove existing roll oval
    if (this.rollOvalEntity) {
      this.viewer.entities.remove(this.rollOvalEntity);
    }
    
    // Create new roll oval entity (polyline like dispersion oval)
    this.rollOvalEntity = this.viewer.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(rollLonLatArr),
        width: 4,
        material: Cesium.Color.ORANGE,
        clampToGround: true,
        classificationType: Cesium.ClassificationType.TERRAIN
      }
    });
    
    console.log(`Roll oval created: center (${rollCenterLon.toFixed(6)}, ${rollCenterLat.toFixed(6)}), width: ${rollWidth}m, depth: ${rollDepth}m`);
    
    return {
      centerLon: rollCenterLon,
      centerLat: rollCenterLat,
      width: rollWidth,
      depth: rollDepth,
      semiMajor: rollSemiMajor,
      semiMinor: rollSemiMinor,
      rotation: rollRotRad
    };
  }

  // ==================== SAMPLE GENERATION ====================
  
  /**
   * Generate random sample points with course feature analysis
   */
  async generateRandomPoints() {
    if (!this.pinEntity) return;
    
    // Check if we need to regenerate based on position change
    const currentWidth = this.ovalWidth;
    const currentDepth = this.ovalDepth;
    const positionChanged = this.shouldRegenerateSamples(this.centerLon, this.centerLat, currentWidth, currentDepth);
    
    if (!positionChanged && this.sampleEntities.length > 0) {
      return; // Skip regeneration if position hasn't changed significantly
    }
    
    // Show loading indicator
    const loadingIndicator = document.getElementById('sampleLoadingIndicator');
    if (loadingIndicator) loadingIndicator.style.display = 'block';
    
    this.clearSamples();
    let sumDist = 0;
    let sumExpectedStrokes = 0;
    let count = 0;
    
    // Condition counting for chart
    const conditionCounts = {
      water: 0, sand: 0, green: 0, tee: 0, fairway: 0, rough: 0, recovery: 0,
      user_hazard: 0, user_ob: 0
    };
    
    console.log(`Generating ${this.rollCondition !== 'no' ? 'combined' : 'standard'} dispersion samples...`);

    // Use global variables for dispersion oval dimensions
    const w = this.ovalWidth;
    const d = this.ovalDepth;
    const semiMajor = Math.max(w, d) / 2;
    const semiMinor = Math.min(w, d) / 2;
    const userRotPts = 0; // Default rotation
    const rotDegPts = ((360 - this.getBaseHeadingDeg()) + userRotPts) % 360;
    const rotRad = Cesium.Math.toRadians(rotDegPts);
    const cosR = Math.cos(rotRad), sinR = Math.sin(rotRad);
    const mPerLon = this.metersPerDegLonAt(this.centerLat);

    const pinCarto = Cesium.Cartographic.fromCartesian(this.pinEntity.position.getValue(Cesium.JulianDate.now()));
    const pinLon = Cesium.Math.toDegrees(pinCarto.longitude);
    const pinLat = Cesium.Math.toDegrees(pinCarto.latitude);
    const geod = new Cesium.EllipsoidGeodesic();

    // Get roll oval parameters if enabled
    const rollOvalParams = this.rollCondition !== 'no' ? this.createRollOval() : null;
    
    // Collect all sample points first for batch terrain sampling
    const samplePoints = [];
    
    if (rollOvalParams) {
      // Rejection sampling from combined dispersion + roll shape
      console.log('Sampling from combined dispersion + roll shape using rejection method');
      
      // Calculate bounding box that encompasses both ovals
      const dispersionRadius = Math.max(semiMajor, semiMinor);
      const rollRadius = Math.max(rollOvalParams.semiMajor, rollOvalParams.semiMinor);
      const maxRadius = Math.max(dispersionRadius, rollRadius);
      
      // Extend bounding box to account for roll oval offset
      const totalBoundingRadius = maxRadius + Math.abs(rollOvalParams.centerLon - this.centerLon) * mPerLon + Math.abs(rollOvalParams.centerLat - this.centerLat) * this.metersPerDegLat;
      
      let samplesGenerated = 0;
      while (samplePoints.length < 600 && samplesGenerated < 3000) { // Safety limit
        samplesGenerated++;
        
        // Generate random point in bounding box
        const angle = 2 * Math.PI * Math.random();
        const radius = totalBoundingRadius * Math.sqrt(Math.random());
        const dx = radius * Math.cos(angle);
        const dy = radius * Math.sin(angle);
        
        const lon = this.centerLon + dx / mPerLon;
        const lat = this.centerLat + dy / this.metersPerDegLat;
        
        // Check if point is inside either oval (dispersion OR roll)
        const inDispersion = this.isPointInEllipse(lon, lat, this.centerLon, this.centerLat, semiMajor, semiMinor, rotRad);
        const inRoll = this.isPointInEllipse(lon, lat, rollOvalParams.centerLon, rollOvalParams.centerLat, rollOvalParams.semiMajor, rollOvalParams.semiMinor, rollOvalParams.rotation);
        
        if (inDispersion || inRoll) {
          samplePoints.push({ lon, lat });
        }
      }
      console.log(`Generated ${samplePoints.length} samples from combined shape (${samplesGenerated} attempts)`);
    } else {
      // Standard sampling from dispersion oval only
      for (let i = 0; i < 600; i++) {
        const { x, y } = this.randomPointInEllipse(semiMajor, semiMinor);
        const xr = x * cosR - y * sinR;
        const yr = x * sinR + y * cosR;
        const lon = this.centerLon + xr / mPerLon;
        const lat = this.centerLat + yr / this.metersPerDegLat;
        samplePoints.push({ lon, lat });
      }
    }
    
    // Process sample points for display and calculations
    const processedPoints = [];
    for (let i = 0; i < samplePoints.length; i++) {
      const { lon, lat } = samplePoints[i];

      geod.setEndPoints(Cesium.Cartographic.fromDegrees(pinLon, pinLat), Cesium.Cartographic.fromDegrees(lon, lat));
      const dist = geod.surfaceDistance;
      const distanceYards = dist * 1.09361; // Convert meters to yards
      
      // Identify course feature and calculate expected strokes with user-defined penalties
      let courseFeature;
      try {
        courseFeature = this.identifyCourseFeature(lon, lat);
      } catch (error) {
        console.warn('Error identifying course feature:', error);
        courseFeature = 'rough'; // Default fallback
      }
      
      // Use advanced calculation if enabled and pin is set
      let expectedStrokes;
      if (this.advancedModeEnabled && this.pinEntity && distanceYards <= 45) {
        const pinCarto = Cesium.Cartographic.fromCartesian(this.pinEntity.position.getValue(Cesium.JulianDate.now()));
        const pinLon = Cesium.Math.toDegrees(pinCarto.longitude);
        const pinLat = Cesium.Math.toDegrees(pinCarto.latitude);
        expectedStrokes = await this.calculateAdvancedExpectedStrokes(distanceYards, lon, lat, pinLon, pinLat);
      } else {
        expectedStrokes = this.calculateExpectedStrokesWithPenalties(distanceYards, lon, lat);
      }
      
      // Determine final feature type for counting (including user-defined areas)
      let finalFeatureType = courseFeature;
      
      // Check if point is in user-defined areas for counting purposes
      try {
        // First check if point is in currently-being-drawn polygon (if it has 3+ points)
        if (this.currentDrawingType && this.currentPolygonPoints.length >= 3) {
          const drawingPolygon = this.currentPolygonPoints.map(p => [p.lon, p.lat]);
          if (this.isPointInPolygon(lon, lat, drawingPolygon)) {
            // Map drawing type to display category
            if (this.currentDrawingType === 'hazards') {
              finalFeatureType = 'user_hazard';
            } else if (this.currentDrawingType === 'ob') {
              finalFeatureType = 'user_ob';
            } else {
              // For other types, use a generic "user_" prefix to distinguish from natural features
              finalFeatureType = 'user_' + this.currentDrawingType;
            }
          }
        }
        
        // Then check completed user-defined conditions (if not already found in drawing polygon)
        if (finalFeatureType === courseFeature && this.userDefinedConditions) {
          // Check all user-defined condition types
          for (const [conditionType, polygons] of Object.entries(this.userDefinedConditions)) {
            if (polygons && Array.isArray(polygons)) {
              for (const polygon of polygons) {
                if (this.isPointInPolygon(lon, lat, polygon)) {
                  // Map condition type to display category
                  if (conditionType === 'hazards') {
                    finalFeatureType = 'user_hazard';
                  } else if (conditionType === 'ob') {
                    finalFeatureType = 'user_ob';
                  } else {
                    // For other types, use "user_" prefix
                    finalFeatureType = 'user_' + conditionType;
                  }
                  break;
                }
              }
              if (finalFeatureType !== courseFeature) break; // Found a match, stop checking
            }
          }
        }
      } catch (error) {
        console.warn('Error checking user-defined conditions:', error);
      }
      
      // Count condition occurrences
      conditionCounts[finalFeatureType] = (conditionCounts[finalFeatureType] || 0) + 1;
      
      // Debug logging for first few points only
      if (this.DEBUG_MODE && i < 2) {
        console.log(`Sample ${i}: course=${courseFeature}, final=${finalFeatureType}, ${distanceYards.toFixed(1)}y, ${expectedStrokes.toFixed(2)} strokes`);
      }
      
      sumDist += dist;
      sumExpectedStrokes += expectedStrokes;
      count++;

      // Color code the sample points by final feature type (including user-defined areas)
      let pointColor = Cesium.Color.YELLOW.withAlpha(0.6); // default
      switch (finalFeatureType) {
        case 'water': pointColor = Cesium.Color.AQUAMARINE.withAlpha(0.9); break;
        case 'green': pointColor = Cesium.Color.LIME.withAlpha(0.8); break;
        case 'tee': pointColor = Cesium.Color.LIGHTGRAY.withAlpha(0.8); break;
        case 'fairway': pointColor = Cesium.Color.GREEN.withAlpha(0.7); break;
        case 'rough': pointColor = Cesium.Color.ORANGE.withAlpha(0.6); break;
        case 'sand': pointColor = Cesium.Color.SANDYBROWN.withAlpha(0.8); break;
        case 'recovery': pointColor = Cesium.Color.RED.withAlpha(0.8); break;
        case 'user_hazard': pointColor = Cesium.Color.DARKRED.withAlpha(0.9); break;
        case 'user_ob': pointColor = Cesium.Color.LIGHTGRAY.withAlpha(0.9); break;
        case 'user_water': pointColor = Cesium.Color.DARKBLUE.withAlpha(0.9); break;
        case 'user_bunkers': pointColor = Cesium.Color.CHOCOLATE.withAlpha(0.9); break;
        case 'user_greens': pointColor = Cesium.Color.DARKGREEN.withAlpha(0.9); break;
        case 'user_fairways': pointColor = Cesium.Color.FORESTGREEN.withAlpha(0.9); break;
        case 'user_roughs': pointColor = Cesium.Color.DARKORANGE.withAlpha(0.9); break;
        case 'user_tees': pointColor = Cesium.Color.GRAY.withAlpha(0.9); break;
        case 'user_recovery': pointColor = Cesium.Color.MAROON.withAlpha(0.9); break;
      }

      processedPoints.push({ lon, lat, pointColor });
    }

    // Progressive loading with batches for smoother experience
    this.clearSamples(); // Clear any existing samples first
    
    // Load samples in batches to maintain 60fps
    const BATCH_SIZE = 100;
    let currentBatch = 0;
    
    const loadNextBatch = () => {
      try {
        const startIndex = currentBatch * BATCH_SIZE;
        const endIndex = Math.min(startIndex + BATCH_SIZE, processedPoints.length);
        
        // Suspend entity events during batch processing
        this.viewer.entities.suspendEvents();
      
        for (let i = startIndex; i < endIndex; i++) {
          const point = processedPoints[i];
          let ent;
          
          // Try to get entity from pool, otherwise create new one
          if (window.performanceManager) {
            ent = window.performanceManager.getEntityFromPool('samplePoints', () => {
              return this.viewer.entities.add({
                point: { 
                  pixelSize: 3, 
                  heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                  disableDepthTestDistance: 1000,
                  scaleByDistance: new Cesium.NearFarScalar(1.5e2, 1.0, 1.5e7, 0.5)
                }
              });
            });
            
            // Update pooled entity properties
            ent.position = Cesium.Cartesian3.fromDegrees(point.lon, point.lat);
            ent.point.color = point.pointColor;
            ent.show = true; // Will be controlled by visibility toggle
          } else {
            // Fallback to direct creation
            ent = this.viewer.entities.add({
              position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat),
              point: { 
                pixelSize: 3, 
                color: point.pointColor, 
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: 1000,
                scaleByDistance: new Cesium.NearFarScalar(1.5e2, 1.0, 1.5e7, 0.5)
              },
              show: true
            });
          }
          
          this.sampleEntities.push(ent);
        }
        
        // Resume entity events
        this.viewer.entities.resumeEvents();
        
        currentBatch++;
        
        // Schedule next batch or finish
        if (endIndex < processedPoints.length) {
          // Use requestAnimationFrame for smooth loading
          requestAnimationFrame(loadNextBatch);
        } else {
          // Force a scene render to ensure clamping is applied
          this.viewer.scene.requestRender();
          
          // Hide loading indicator
          const loadingIndicator = document.getElementById('sampleLoadingIndicator');
          if (loadingIndicator) loadingIndicator.style.display = 'none';
        }
        
      } catch (error) {
        console.warn('Error during sample batch loading:', error);
        
        // Resume events even on error
        try {
          this.viewer.entities.resumeEvents();
        } catch (resumeError) {
          console.warn('Error resuming entity events:', resumeError);
        }
        
        // Hide loading indicator
        const loadingIndicator = document.getElementById('sampleLoadingIndicator');
        if (loadingIndicator) loadingIndicator.style.display = 'none';
        
        // Try to continue with next batch or stop gracefully
        currentBatch++;
        if (currentBatch * BATCH_SIZE < processedPoints.length) {
          setTimeout(() => requestAnimationFrame(loadNextBatch), 100);
        }
      }
    };
    
    // Start loading after terrain is ready using proper Cesium timing
    const startLoading = () => {
      // Remove this listener after first use
      this.viewer.scene.postRender.removeEventListener(startLoading);
      // Small delay to ensure terrain processing is complete
      requestAnimationFrame(loadNextBatch);
    };
    
    // Wait for next render cycle, then start loading
    this.viewer.scene.postRender.addEventListener(startLoading);
    
    // Update displays
    const avgDistance = count ? (sumDist / count) : 0;
    const avgExpectedStrokes = count ? (sumExpectedStrokes / count) : 0;
    
    // Trigger display updates via events
    this.triggerDisplayUpdate('avgDistance', avgDistance);
    this.triggerDisplayUpdate('expectedStrokes', avgExpectedStrokes);
    this.triggerDisplayUpdate('conditionBreakdown', { conditionCounts, totalCount: count, advancedMode: this.advancedModeEnabled });
    
    this.updateSampleVisibility();
  }

  /**
   * Check if samples should be regenerated based on position changes
   */
  shouldRegenerateSamples(currentLon, currentLat, currentWidth, currentDepth) {
    // Always regenerate on first run
    if (this.lastSamplePosition.lon === 0 && this.lastSamplePosition.lat === 0) {
      this.lastSamplePosition = { lon: currentLon, lat: currentLat, width: currentWidth, depth: currentDepth };
      return true;
    }
    
    // Calculate distance moved in meters (rough approximation)
    const lonDiff = currentLon - this.lastSamplePosition.lon;
    const latDiff = currentLat - this.lastSamplePosition.lat;
    const distanceMeters = Math.sqrt(lonDiff * lonDiff + latDiff * latDiff) * 111000; // ~111km per degree
    
    // Check if oval dimensions changed significantly  
    const widthChanged = Math.abs(currentWidth - this.lastSamplePosition.width) > 5;
    const depthChanged = Math.abs(currentDepth - this.lastSamplePosition.depth) > 5;
    
    const shouldRegenerate = distanceMeters > this.POSITION_THRESHOLD_METERS || widthChanged || depthChanged;
    
    if (shouldRegenerate) {
      this.lastSamplePosition = { lon: currentLon, lat: currentLat, width: currentWidth, depth: currentDepth };
    }
    
    return shouldRegenerate;
  }

  /**
   * Clear sample entities
   */
  clearSamples() {
    // Return entities to pool instead of removing them
    this.sampleEntities.forEach(entity => {
      if (window.performanceManager) {
        window.performanceManager.returnEntityToPool('samplePoints', entity);
      } else {
        this.viewer.entities.remove(entity);
      }
    });
    this.sampleEntities.length = 0; // Clear array more efficiently
    
    // Also clear roll oval if it exists
    if (this.rollOvalEntity) {
      this.viewer.entities.remove(this.rollOvalEntity);
      this.rollOvalEntity = null;
    }
    
    // Reset position tracking to force regeneration next time
    this.lastSamplePosition = { lon: 0, lat: 0, width: 0, depth: 0 };
  }

  /**
   * Update sample visibility
   */
  updateSampleVisibility() {
    const show = true; // This should be controlled by UI toggle
    this.sampleEntities.forEach(e => e.show = show);
  }

  // ==================== CAMERA POSITIONING ====================
  
  /**
   * Position camera for shot POV (first-person view from tee)
   */
  async shotPOVCamera() {
    if (!this.launchEntity) { 
      console.warn('No tee position set');
      return; 
    }
    if (this.centerLon === 0 && this.centerLat === 0) {
      console.warn('No aim point set');
      return;
    }

    const jd = Cesium.JulianDate.now();
    const teePosition = this.launchEntity.position.getValue(jd);
    
    const teeCarto = Cesium.Cartographic.fromCartesian(teePosition);
    
    const teeLon = Cesium.Math.toDegrees(teeCarto.longitude);
    const teeLat = Cesium.Math.toDegrees(teeCarto.latitude);
    const aimLon = this.centerLon;
    const aimLat = this.centerLat;
    
    // Calculate heading from tee to aim point
    const headingDeg = this.computeHeadingDeg(teeLon, teeLat, aimLon, aimLat);
    const headingRad = Cesium.Math.toRadians(headingDeg);
    
    // Calculate position 25 meters backward from tee position
    const backwardHeadingRad = headingRad + Math.PI; // Opposite direction
    const offsetDistance = 25; // meters
    
    const R = 6378137.0; // Earth radius in meters
    const teeLatRad = Cesium.Math.toRadians(teeLat);
    const teeLonRad = Cesium.Math.toRadians(teeLon);
    
    const dLat = (offsetDistance * Math.cos(backwardHeadingRad)) / R;
    const dLon = (offsetDistance * Math.sin(backwardHeadingRad)) / (R * Math.cos(teeLatRad));
    
    const cameraLatRad = teeLatRad + dLat;
    const cameraLonRad = teeLonRad + dLon;
    const cameraLat = Cesium.Math.toDegrees(cameraLatRad);
    const cameraLon = Cesium.Math.toDegrees(cameraLonRad);
    
    console.log(`Shot POV: Tee at (${teeLon.toFixed(6)}, ${teeLat.toFixed(6)})`);
    console.log(`Shot POV: Camera at (${cameraLon.toFixed(6)}, ${cameraLat.toFixed(6)})`);
    console.log(`Shot POV: Heading ${headingDeg.toFixed(1)}°, offset distance ${offsetDistance}m`);
    
    // Get terrain height at camera position
    let terrainHeight = 0;
    try {
      const [sample] = await Cesium.sampleTerrainMostDetailed(
        this.viewer.terrainProvider,
        [Cesium.Cartographic.fromDegrees(cameraLon, cameraLat)]
      );
      terrainHeight = sample.height || 0;
    } catch (e) {
      console.warn('terrain sample failed', e);
    }
    
    // Position camera 6 meters above terrain at camera position
    const cameraHeight = terrainHeight + 6;
    
    // Set camera to view from 25m behind tee position
    this.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(cameraLon, cameraLat, cameraHeight),
      orientation: {
        heading: headingRad,  // Look towards aim point
        pitch: Cesium.Math.toRadians(-2),  // Look 2 degrees down
        roll: 0  // No roll
      },
      duration: 1.0
    });
  }

  /**
   * Move camera for shot analysis view
   */
  async moveCameraShot() {
    if (!this.launchEntity) { console.warn('No launch point set'); return; }

    const jd = Cesium.JulianDate.now();
    const lCarto = Cesium.Cartographic.fromCartesian(this.launchEntity.position.getValue(jd));
    const lLon = Cesium.Math.toDegrees(lCarto.longitude);
    const lLat = Cesium.Math.toDegrees(lCarto.latitude);

    const geod = new Cesium.EllipsoidGeodesic();
    geod.setEndPoints(
      Cesium.Cartographic.fromDegrees(lLon, lLat),
      Cesium.Cartographic.fromDegrees(this.centerLon, this.centerLat)
    );
    const shotDist = geod.surfaceDistance;

    const headingDeg = this.computeHeadingDeg(lLon, lLat, this.centerLon, this.centerLat);
    const headingRad = Cesium.Math.toRadians(headingDeg);

    const offset = Math.max(Math.pow(shotDist, 0.82) * 1.9 + 20, 50);
    const backwardHeadingRad = headingRad + Math.PI;
    const lLatRad = Cesium.Math.toRadians(lLat);
    const lLonRad = Cesium.Math.toRadians(lLon);
    const R = 6378137.0;
    const dLat = (offset * Math.cos(backwardHeadingRad)) / R;
    const dLon = (offset * Math.sin(backwardHeadingRad)) / (R * Math.cos(lLatRad));
    const destLatRad = lLatRad + dLat;
    const destLonRad = lLonRad + dLon;

    let terrainHeight = 0;
    try {
      const [sample] = await Cesium.sampleTerrainMostDetailed(
        this.viewer.terrainProvider,
        [Cesium.Cartographic.fromDegrees(this.centerLon, this.centerLat)]
      );
      terrainHeight = sample.height || 0;
    } catch (e) {
      console.warn('terrain sample failed', e);
    }

    const height = Math.max(Math.pow(shotDist, 0.65) * 3 + terrainHeight + 30, 100);
    const pitch = Cesium.Math.toRadians(-40 + Math.pow(shotDist, 0.5));

    this.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromRadians(destLonRad, destLatRad, height),
      orientation: {
        heading: Cesium.Math.toRadians(headingDeg),
        pitch,
        roll: 0
      },
      duration: 0.35
    });
  }

  // ==================== UTILITY FUNCTIONS ====================
  
  /**
   * Convert Cartesian to degrees
   */
  cartToDeg(c) {
    const cc = Cesium.Cartographic.fromCartesian(c);
    return [Cesium.Math.toDegrees(cc.longitude), Cesium.Math.toDegrees(cc.latitude), cc.height||0];
  }

  /**
   * Point-in-polygon test for degree coordinates
   */
  pointInPolyDeg(lon, lat, polyDeg2D) {
    let inside = false;
    for (let i = 0, j = polyDeg2D.length - 1; i < polyDeg2D.length; j = i++) {
      const xi = polyDeg2D[i][0], yi = polyDeg2D[i][1];
      const xj = polyDeg2D[j][0], yj = polyDeg2D[j][1];
      const intersect = ((yi > lat) !== (yj > lat)) &&
                        (lon < (xj - xi) * (lat - yi) / (yj - yi + 1e-20) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  /**
   * Point-in-polygon test for user-defined areas
   */
  isPointInPolygon(lon, lat, polygon) {
    if (!polygon || !Array.isArray(polygon) || polygon.length < 3) {
      return false;
    }
    
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      if (((polygon[i].lat > lat) !== (polygon[j].lat > lat)) &&
          (lon < (polygon[j].lon - polygon[i].lon) * (lat - polygon[i].lat) / (polygon[j].lat - polygon[i].lat) + polygon[i].lon)) {
        inside = !inside;
      }
    }
    return inside;
  }

  /**
   * Calculate heading between two points in degrees
   */
  computeHeadingDeg(fromLon, fromLat, toLon, toLat) {
    const φ1 = Cesium.Math.toRadians(fromLat);
    const φ2 = Cesium.Math.toRadians(toLat);
    const λ1 = Cesium.Math.toRadians(fromLon);
    const λ2 = Cesium.Math.toRadians(toLon);
    const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
    let brng = Cesium.Math.toDegrees(Math.atan2(y, x));
    brng = (brng + 360) % 360;
    return brng;
  }

  /**
   * Get base heading from launch position to aim point
   */
  getBaseHeadingDeg() {
    if (!this.launchEntity) return 0;
    const jd = Cesium.JulianDate.now();
    const carto = Cesium.Cartographic.fromCartesian(this.launchEntity.position.getValue(jd));
    const lLon = Cesium.Math.toDegrees(carto.longitude);
    const lLat = Cesium.Math.toDegrees(carto.latitude);
    return this.computeHeadingDeg(lLon, lLat, this.centerLon, this.centerLat);
  }

  /**
   * Get polygon center point
   */
  getPolygonCenter(polygon) {
    let sumX = 0, sumY = 0, sumZ = 0;
    for (const point of polygon) {
      sumX += point.x;
      sumY += point.y; 
      sumZ += point.z;
    }
    return new Cesium.Cartesian3(sumX / polygon.length, sumY / polygon.length, sumZ / polygon.length);
  }

  /**
   * Format distance based on units setting
   */
  formatDistance(meters, useYards = false) {
    if (useYards) {
      const yards = meters * 1.09361;
      if (yards < 10) {
        const feet = yards * 3;
        return feet.toFixed(0) + 'ft';
      }
      return yards.toFixed(0) + 'y';
    } else {
      return meters.toFixed(1) + 'm';
    }
  }

  // ==================== EVENT HANDLING ====================
  
  /**
   * Set up event handlers
   */
  setupEventHandlers() {
    // Mouse click handler for placing points
    const handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
    handler.setInputAction(async (movement) => {
      const cartesian = this.viewer.scene.pickPosition(movement.position);
      if (!cartesian) return;
      
      const carto = Cesium.Cartographic.fromCartesian(cartesian);
      const lon = Cesium.Math.toDegrees(carto.longitude);
      const lat = Cesium.Math.toDegrees(carto.latitude);

      // Check for optimization candidate selection first
      const pickedObject = this.viewer.scene.pick(movement.position);
      if (pickedObject && pickedObject.id) {
        const entity = pickedObject.id;
        
        // Check if clicked on an optimization candidate
        const candidateIndex = this.candidateEntities.indexOf(entity);
        if (candidateIndex >= 0) {
          this.selectOptimizationCandidate(candidateIndex);
          return;
        }
      }

      // Handle optimization toolbar condition drawing
      if (this.currentDrawingType) {
        this.currentPolygonPoints.push({ lon, lat });
        
        // Add a point marker with appropriate styling
        const style = this.getConditionStyle(this.currentDrawingType);
        this.viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(lon, lat),
          point: {
            pixelSize: 6,
            color: style.outline,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 1,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
          }
        });
        
        // Update the drawing polygon
        if (this.currentPolygonPoints.length >= 3) {
          if (this.drawingPolygonEntity) {
            this.viewer.entities.remove(this.drawingPolygonEntity);
          }
          
          this.drawingPolygonEntity = this.viewer.entities.add({
            polygon: {
              hierarchy: new Cesium.PolygonHierarchy(
                this.currentPolygonPoints.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat))
              ),
              material: style.color,
              outline: true,
              outlineColor: style.outline,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
            }
          });
        }
        
        console.log(`Added point ${this.currentPolygonPoints.length} for ${this.currentDrawingType} area`);
        
        // Update sample points in real-time while drawing (if we have 3+ points for a valid polygon)
        if (this.currentPolygonPoints.length >= 3 && this.sampleEntities.length > 0) {
          this.generateRandomPoints();
        }
        
        return;
      }

      // Existing point placement logic
      if (this.selectingOval) {
        this.centerLon = lon; 
        this.centerLat = lat;
        this.clearOptimizationCandidates(); // Clear previous optimization
        this.rebuildOval();
        this.autoSizeFromSkill();
        this.generateRandomPoints();
        this.updateDistanceDisplays();
      } else if (this.selectingPin) {
        await this.placePin(lon, lat);
        this.clearOptimizationCandidates(); // Clear previous optimization
        this.generateRandomPoints();
        this.updateDistanceDisplays();
      } else if (this.selectingLaunch) {
        if (this.launchEntity) this.viewer.entities.remove(this.launchEntity);
        this.clearOptimizationCandidates(); // Clear previous optimization
        
        // Sample terrain for proper height
        try {
          const [sample] = await Cesium.sampleTerrainMostDetailed(
            this.viewer.terrainProvider,
            [new Cesium.Cartographic(Cesium.Math.toRadians(lon), Cesium.Math.toRadians(lat), 0)]
          );
          
          this.launchEntity = this.viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(lon, lat),
            point: { pixelSize: 5, color: Cesium.Color.CYAN, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: 1000 }
          });
        } catch (error) {
          this.launchEntity = this.viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(lon, lat),
            point: { pixelSize: 5, color: Cesium.Color.CYAN, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: 1000 }
          });
        }
        
        this.autoSizeFromSkill();
        this.updateDistanceDisplays();
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  /**
   * Get condition style for visualization
   */
  getConditionStyle(conditionType) {
    const conditionStyles = {
      water: { color: Cesium.Color.AQUAMARINE.withAlpha(0.4), outline: Cesium.Color.BLUE },
      bunkers: { color: Cesium.Color.SANDYBROWN.withAlpha(0.4), outline: Cesium.Color.GOLDENROD },
      greens: { color: Cesium.Color.LIME.withAlpha(0.4), outline: Cesium.Color.GREEN },
      tees: { color: Cesium.Color.LIGHTGRAY.withAlpha(0.4), outline: Cesium.Color.GRAY },
      fairways: { color: Cesium.Color.GREEN.withAlpha(0.3), outline: Cesium.Color.DARKGREEN },
      roughs: { color: Cesium.Color.ORANGE.withAlpha(0.4), outline: Cesium.Color.DARKORANGE },
      hazards: { color: Cesium.Color.RED.withAlpha(0.3), outline: Cesium.Color.DARKRED },
      ob: { color: Cesium.Color.WHITE.withAlpha(0.5), outline: Cesium.Color.BLACK },
      recovery: { color: Cesium.Color.PURPLE.withAlpha(0.4), outline: Cesium.Color.DARKVIOLET }
    };
    
    return conditionStyles[conditionType] || conditionStyles.hazards;
  }

  /**
   * Trigger display update events (for dashboard integration)
   */
  triggerDisplayUpdate(type, data) {
    // This method allows the dashboard to listen for updates
    const event = new CustomEvent('aiCaddieUpdate', {
      detail: { type, data }
    });
    window.dispatchEvent(event);
  }

  // ==================== AUTO-SIZING FROM SKILL ====================
  
  /**
   * Auto-size oval based on skill level
   */
  async autoSizeFromSkill() {
    this.sizingFromSkill = true;
    
    // This would be connected to UI skill selector
    const skillLevel = 'average'; // Default or from UI
    const skill = this.SKILL_LEVELS[skillLevel];
    
    if (!this.launchEntity || !skill) {
      this.sizingFromSkill = false;
      return;
    }
    
    const geod = new Cesium.EllipsoidGeodesic();
    const launchCarto = Cesium.Cartographic.fromCartesian(this.launchEntity.position.getValue(Cesium.JulianDate.now()));
    const lLon = Cesium.Math.toDegrees(launchCarto.longitude);
    const lLat = Cesium.Math.toDegrees(launchCarto.latitude);

    // Intended distance: launch to aim point (oval center)
    geod.setEndPoints(
      Cesium.Cartographic.fromDegrees(lLon, lLat),
      Cesium.Cartographic.fromDegrees(this.centerLon, this.centerLat)
    );
    const intendedDist = geod.surfaceDistance;
    
    const theta = Cesium.Math.toRadians(skill.offlineDeg);
    const halfWidth = Math.tan(theta) * intendedDist;
    const width = 2 * halfWidth;
    const depth = 2 * (skill.distPct * intendedDist);

    // Update global oval dimensions with calculated values
    this.ovalWidth = Math.max(5, width); // Minimum 5 meters width
    this.ovalDepth = Math.max(3, depth); // Minimum 3 meters depth
    
    console.log(`Auto-sized oval for ${this.formatDistance(intendedDist)} shot: ${this.ovalWidth.toFixed(1)}m x ${this.ovalDepth.toFixed(1)}m`);
    
    this.rebuildOval();
    this.generateRandomPoints();
    this.sizingFromSkill = false;
  }

  // ==================== PLACEMENT FUNCTIONS ====================
  
  /**
   * Place pin at specified coordinates
   */
  async placePin(lon, lat, terrainHeight = null) {
    if (this.pinEntity) this.viewer.entities.remove(this.pinEntity);
    
    // Always use CLAMP_TO_GROUND - ignore terrainHeight parameter
    console.log(`Placing pin at (${lon.toFixed(4)}, ${lat.toFixed(4)}) with CLAMP_TO_GROUND`);
    
    // Create pin with ground clamping
    this.pinEntity = this.viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      billboard: {
        image: 'data:image/svg+xml;base64,' + btoa(`
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14">
            <polygon points="7,1 13,13 7,10 1,13" fill="yellow" stroke="black" stroke-width="1"/>
          </svg>
        `),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        pixelOffset: new Cesium.Cartesian2(0, -7),
        disableDepthTestDistance: 1000
      }
    });
    
    // Force a scene render and update to ensure proper ground clamping
    this.viewer.scene.requestRender();
    
    // Small delay to ensure terrain is loaded and pin is properly clamped
    setTimeout(() => {
      if (this.pinEntity) {
        this.pinEntity.show = false;
        setTimeout(() => {
          if (this.pinEntity) this.pinEntity.show = true;
        }, 50);
      }
    }, 100);
  }

  // ==================== OPTIMIZATION SYSTEM ====================
  
  /**
   * Clear optimization candidates
   */
  clearOptimizationCandidates() {
    this.candidateEntities.forEach(entity => this.viewer.entities.remove(entity));
    this.candidateEntities = [];
  }

  /**
   * Select optimization candidate as new aim point
   */
  selectOptimizationCandidate(index) {
    if (index >= 0 && index < this.optimizationCandidates.length) {
      const candidate = this.optimizationCandidates[index];
      this.centerLon = candidate.lon;
      this.centerLat = candidate.lat;
      
      this.rebuildOval();
      this.generateRandomPoints();
      this.updateDistanceDisplays();
      
      console.log(`Selected candidate ${index + 1}: (${candidate.lon.toFixed(4)}, ${candidate.lat.toFixed(4)}) - ${candidate.expectedStrokes.toFixed(2)} strokes`);
    }
  }

  // ==================== DISTANCE CALCULATION ====================
  
  /**
   * Update distance displays with terrain elevation
   */
  async updateDistanceDisplays() {
    if (!this.launchEntity) return;
    
    const geod = new Cesium.EllipsoidGeodesic();
    const launchCarto = Cesium.Cartographic.fromCartesian(this.launchEntity.position.getValue(Cesium.JulianDate.now()));
    const lLon = Cesium.Math.toDegrees(launchCarto.longitude);
    const lLat = Cesium.Math.toDegrees(launchCarto.latitude);

    // Batch terrain sampling for all positions at once (PERFORMANCE OPTIMIZATION)
    const positionsToSample = [];
    let intendedDist = 0;
    let shotDist = 0;
    let pinLon, pinLat;
    
    // Calculate intended distance and add oval position to batch
    if (this.centerLon !== 0 || this.centerLat !== 0) {
      geod.setEndPoints(
        Cesium.Cartographic.fromDegrees(lLon, lLat),
        Cesium.Cartographic.fromDegrees(this.centerLon, this.centerLat)
      );
      intendedDist = geod.surfaceDistance;
      positionsToSample.push(
        new Cesium.Cartographic(Cesium.Math.toRadians(this.centerLon), Cesium.Math.toRadians(this.centerLat), 0)
      );
    }
    
    // Calculate shot distance and add pin position to batch
    if (this.pinEntity) {
      const pinCarto = Cesium.Cartographic.fromCartesian(this.pinEntity.position.getValue(Cesium.JulianDate.now()));
      pinLon = Cesium.Math.toDegrees(pinCarto.longitude);
      pinLat = Cesium.Math.toDegrees(pinCarto.latitude);
      
      geod.setEndPoints(
        Cesium.Cartographic.fromDegrees(lLon, lLat),
        Cesium.Cartographic.fromDegrees(pinLon, pinLat)
      );
      shotDist = geod.surfaceDistance;
      positionsToSample.push(
        new Cesium.Cartographic(Cesium.Math.toRadians(pinLon), Cesium.Math.toRadians(pinLat), 0)
      );
    }
    
    // Trigger distance display updates
    this.triggerDisplayUpdate('intendedDistance', intendedDist);
    this.triggerDisplayUpdate('shotDistance', shotDist);
  }

  // ==================== MEMORY MANAGEMENT ====================
  
  /**
   * Perform memory cleanup
   */
  performMemoryCleanup() {
    // Clear samples
    this.clearSamples();
    
    // Clear performance manager entity pools
    if (window.performanceManager) {
      window.performanceManager.clearEntityPool('samplePoints', this.viewer);
      
      // Clear any active debounce timers
      window.performanceManager.debounceTimers.clear();
    }
    
    // Clear course feature cache
    this.currentCachedHoleId = null;
    this.courseFeatureCache = null;
    
    // Force garbage collection hint
    if (window.gc) {
      try {
        window.gc();
      } catch (e) {
        // gc() may not be available in all environments
      }
    }
    
    if (this.DEBUG_MODE) console.log('Memory cleanup completed');
  }

  /**
   * Clear all entities and reset state
   */
  clearAll() {
    // Clear oval and center point
    if (this.ovalEntity) {
      this.viewer.entities.remove(this.ovalEntity);
      this.ovalEntity = null;
    }
    if (this.centerPointEntity) {
      this.viewer.entities.remove(this.centerPointEntity);
      this.centerPointEntity = null;
    }
    
    // Clear pin
    if (this.pinEntity) {
      this.viewer.entities.remove(this.pinEntity);
      this.pinEntity = null;
    }
    
    // Clear launch/tee position
    if (this.launchEntity) {
      this.viewer.entities.remove(this.launchEntity);
      this.launchEntity = null;
    }
    
    // Clear green center marker
    if (window.greenCenterMarker) {
      this.viewer.entities.remove(window.greenCenterMarker);
      window.greenCenterMarker = null;
    }
    
    // Clear samples
    this.clearSamples();
    
    // Reset center coordinates
    this.centerLon = 0;
    this.centerLat = 0;
    
    // Reset selection states
    this.selectingOval = false;
    this.selectingPin = false;
    this.selectingLaunch = false;
    
    // Trigger UI updates
    this.triggerDisplayUpdate('clearAll', true);
  }
}

// ==================== SLOPE ANALYSIS MODULE ====================

class SlopeAnalysisModule {
  constructor(viewer) {
    this.viewer = viewer;
    this.slopeArrowDS = new Cesium.CustomDataSource("slopeArrows");
    this.viewer.dataSources.add(this.slopeArrowDS);
    this.slopeDots = this.viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
  }

  /**
   * Build slope visualization for green
   */
  async buildSlopeForGreen(greenPolyCart, showArrows = true, showDots = true, stepSize = 2) {
    if (!greenPolyCart || greenPolyCart.length < 3) return;
    if (!showArrows && !showDots) return;

    this.slopeArrowDS.entities.removeAll();
    this.slopeDots.removeAll();

    console.log('Building slope visualization for green...');

    try {
      // Convert poly to lon/lat (deg)
      const polyDeg = greenPolyCart.map(p => this.cartToDeg(p).slice(0, 2));
      
      // BBox with buffer
      const lons = polyDeg.map(p => p[0]);
      const lats = polyDeg.map(p => p[1]);
      let west = Math.min(...lons), east = Math.max(...lons);
      let south = Math.min(...lats), north = Math.max(...lats);

      const extraMeters = 9.144; // 10 yards
      const latMid = (north + south) * 0.5;
      const mLat = 111132.0;
      const mLon = 111320.0 * Math.cos(Cesium.Math.toRadians(latMid));
      const dLat = extraMeters / mLat;
      const dLon = extraMeters / mLon;
      west -= dLon; east += dLon;
      south -= dLat; north += dLat;

      const stepM = Math.max(1, stepSize);
      const stepDegLat = stepM / mLat;
      const stepDegLon = stepM / mLon;
      const nLat = Math.floor((north - south) / stepDegLat) + 1;
      const nLon = Math.floor((east - west) / stepDegLon) + 1;

      if (nLat < 2 || nLon < 2) return;

      // Create cartographics for terrain sampling
      const cartos = [];
      const mask = new Uint8Array(nLat * nLon);
      
      for (let i = 0; i < nLat; i++) {
        const lat = south + i * stepDegLat;
        for (let j = 0; j < nLon; j++) {
          const lon = west + j * stepDegLon;
          const idx = i * nLon + j;

          // Simple point-in-polygon check
          const inside = this.pointInPolyDeg(lon, lat, polyDeg);
          let ok = false;
          if (inside) {
            ok = true;
          } else {
            // Allow within 10 yards
            const d = this.distPointToPolyMeters(lon, lat, polyDeg, mLat, mLon);
            if (d <= extraMeters) ok = true;
          }

          if (ok) {
            mask[idx] = 1;
            cartos.push(new Cesium.Cartographic(
              Cesium.Math.toRadians(lon), Cesium.Math.toRadians(lat), 0
            ));
          }
        }
      }

      if (cartos.length === 0) return;

      console.log(`Sampling ${cartos.length} terrain points`);
      const terrain = this.viewer.terrainProvider;
      const sampled = await Cesium.sampleTerrainMostDetailed(terrain, cartos);
      
      // Put heights back into a dense grid
      const heights = new Float32Array(nLat * nLon);
      heights.fill(NaN);
      let k = 0;
      for (let i = 0; i < nLat; i++) {
        for (let j = 0; j < nLon; j++) {
          const idx = i * nLon + j;
          if (mask[idx]) {
            heights[idx] = sampled[k++].height;
          }
        }
      }

      // Simple smoothing
      const smoothed = this.smoothGrid(heights, nLat, nLon);
      const finite = smoothed.filter(Number.isFinite);
      const hMin = finite.length ? Math.min(...finite) : 0;
      const hMax = finite.length ? Math.max(...finite) : 1;
      const hRange = Math.max(1e-6, hMax - hMin);

      // Create slope arrows and elevation dots
      const ARROW_LEN_M = 0.8 * stepM;
      const ARROW_WIDTH = 6 * 0.7 * stepM;
      const hOffset = 0.05;

      const h = (i, j) => smoothed[i * nLon + j];

      for (let i = 1; i < nLat - 1; i++) {
        const lat = south + i * stepDegLat;
        for (let j = 1; j < nLon - 1; j++) {
          const lon = west + j * stepDegLon;
          const idx = i * nLon + j;
          if (!mask[idx]) continue;

          const zc = h(i, j);
          if (!Number.isFinite(zc)) continue;
          const zL = h(i, j - 1), zR = h(i, j + 1);
          const zB = h(i - 1, j), zT = h(i + 1, j);
          if (![zL, zR, zB, zT].every(Number.isFinite)) continue;

          const dzdx = (zR - zL) / (2 * stepDegLon * mLon);
          const dzdy = (zT - zB) / (2 * stepDegLat * mLat);
          const sx = -dzdx, sy = -dzdy;
          const mag = Math.hypot(sx, sy);
          if (mag < 1e-6) continue;

          const slopePercent = mag * 100;
          let color;
          if (slopePercent < 0.5) {
            color = Cesium.Color.GRAY.withAlpha(0.4);
          } else if (slopePercent >= 12) {
            color = Cesium.Color.fromCssColorString("#800000");
          } else {
            const t = (slopePercent - 0.5) / (12 - 0.5);
            const hue = 240 * (1 - t);
            color = Cesium.Color.fromHsl(hue / 360, 1, 0.45);
          }

          const z = zc + hOffset;

          // elevation dots
          if (showDots) {
            const t = (zc - hMin) / hRange;
            this.slopeDots.add({
              position: Cesium.Cartesian3.fromDegrees(lon, lat, z),
              pixelSize: 4,
              color: Cesium.Color.fromHsl(0.6 - 0.6 * t, 1, 0.5)
            });
          }

          // slope arrows
          if (showArrows) {
            const scale = ARROW_LEN_M / mag;
            const dxDeg = (sx * scale) / mLon;
            const dyDeg = (sy * scale) / mLat;
            const zEnd = z - (ARROW_LEN_M * mag);

            this.slopeArrowDS.entities.add({
              polyline: {
                positions: Cesium.Cartesian3.fromRadiansArrayHeights([
                  Cesium.Math.toRadians(lon), Cesium.Math.toRadians(lat), z,
                  Cesium.Math.toRadians(lon + dxDeg), Cesium.Math.toRadians(lat + dyDeg), zEnd
                ]),
                width: ARROW_WIDTH,
                material: new Cesium.PolylineArrowMaterialProperty(color),
                clampToGround: false
              }
            });
          }
        }
      }

      this.slopeArrowDS.show = showArrows;
      this.slopeDots.show = showDots;
      
      console.log(`Slope analysis complete. Generated ${this.slopeArrowDS.entities.values.length} arrows, ${this.slopeDots.length} dots`);
      
    } catch (error) {
      console.error('Error building slope visualization:', error);
    }
  }

  cartToDeg(c) {
    const cc = Cesium.Cartographic.fromCartesian(c);
    return [Cesium.Math.toDegrees(cc.longitude), Cesium.Math.toDegrees(cc.latitude), cc.height||0];
  }

  pointInPolyDeg(lon, lat, polyDeg2D) {
    let inside = false;
    for (let i = 0, j = polyDeg2D.length - 1; i < polyDeg2D.length; j = i++) {
      const xi = polyDeg2D[i][0], yi = polyDeg2D[i][1];
      const xj = polyDeg2D[j][0], yj = polyDeg2D[j][1];
      const intersect = ((yi > lat) !== (yj > lat)) &&
                        (lon < (xj - xi) * (lat - yi) / (yj - yi + 1e-20) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  distPointToPolyMeters(lon, lat, polyDeg2D, mLat, mLon) {
    const px = lon * mLon, py = lat * mLat;
    let best = Infinity;
    for (let i = 0, j = polyDeg2D.length - 1; i < polyDeg2D.length; j = i++) {
      const [lon1, lat1] = polyDeg2D[j];
      const [lon2, lat2] = polyDeg2D[i];
      const x1 = lon1 * mLon, y1 = lat1 * mLat;
      const x2 = lon2 * mLon, y2 = lat2 * mLat;
      const dx = x2 - x1, dy = y2 - y1;
      const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy || 1)));
      const cx = x1 + t * dx, cy = y1 + t * dy;
      const d = Math.hypot(px - cx, py - cy);
      if (d < best) best = d;
    }
    return best;
  }

  smoothGrid(src, rows, cols) {
    const dst = new Float32Array(src.length);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let sum = 0, n = 0;
        for (let dr = -1; dr <= 1; dr++) {
          const rr = r + dr; if (rr < 0 || rr >= rows) continue;
          for (let dc = -1; dc <= 1; dc++) {
            const cc = c + dc; if (cc < 0 || cc >= cols) continue;
            const v = src[rr * cols + cc];
            if (Number.isFinite(v)) { sum += v; n++; }
          }
        }
        dst[r * cols + c] = n ? sum / n : NaN;
      }
    }
    return dst;
  }
  
  // ==================== ADVANCED SHORT GAME SYSTEM ====================
  
  /**
   * Load short game modifier lookup table
   */
  async loadShortGameModifiers() {
    try {
      const response = await fetch('short_game_modifiers.json');
      this.shortGameModifiers = await response.json();
      console.log(`Loaded ${Object.keys(this.shortGameModifiers).length} short game modifiers`);
    } catch (error) {
      console.warn('Failed to load short game modifiers:', error);
      this.shortGameModifiers = {};
    }
  }
  
  /**
   * Enable/disable advanced short game mode
   */
  setAdvancedMode(enabled) {
    this.advancedModeEnabled = enabled;
    console.log(`Advanced short game mode: ${enabled ? 'enabled' : 'disabled'}`);
  }
  
  /**
   * Calculate slope vector between two points using terrain sampling
   */
  async calculateSlopeVector(fromLon, fromLat, toLon, toLat, stepSize = 2) {
    try {
      // Create sample points along the line
      const distance = this.calculateDistance(fromLon, fromLat, toLon, toLat);
      const numSteps = Math.max(3, Math.ceil(distance / stepSize));
      
      const positions = [];
      for (let i = 0; i <= numSteps; i++) {
        const t = i / numSteps;
        const lon = fromLon + t * (toLon - fromLon);
        const lat = fromLat + t * (toLat - fromLat);
        positions.push(Cesium.Cartographic.fromDegrees(lon, lat));
      }
      
      // Sample terrain elevations
      const sampledPositions = await Cesium.sampleTerrainMostDetailed(
        this.viewer.terrainProvider,
        positions
      );
      
      // Calculate slope along the line
      const elevations = sampledPositions.map(p => p.height || 0);
      const totalElevationChange = elevations[elevations.length - 1] - elevations[0];
      const slopePercent = (totalElevationChange / (distance * 1000)) * 100; // Convert to percentage
      
      return {
        slopePercent: slopePercent,
        elevationChange: totalElevationChange,
        distance: distance * 1000 // Return in meters
      };
    } catch (error) {
      console.warn('Error calculating slope vector:', error);
      return { slopePercent: 0, elevationChange: 0, distance: 0 };
    }
  }
  
  /**
   * Classify ball lie (stance) relative to pin direction
   */
  async classifyBallLie(ballLon, ballLat, pinLon, pinLat) {
    // Calculate slope at ball position in multiple directions
    const stepSize = 2; // meters
    const directions = [
      { name: 'toward_pin', lon: pinLon, lat: pinLat },
      { name: 'perpendicular', lon: ballLon + (pinLat - ballLat) * 0.0001, lat: ballLat - (pinLon - ballLon) * 0.0001 }
    ];
    
    let maxSlope = 0;
    let primaryDirection = 'flat';
    
    for (const dir of directions) {
      const slope = await this.calculateSlopeVector(ballLon, ballLat, dir.lon, dir.lat, stepSize);
      if (Math.abs(slope.slopePercent) > Math.abs(maxSlope)) {
        maxSlope = slope.slopePercent;
        
        if (Math.abs(maxSlope) < 2) {
          primaryDirection = 'flat';
        } else if (dir.name === 'toward_pin') {
          primaryDirection = maxSlope > 0 ? 'uphill' : 'downhill';
        } else {
          primaryDirection = 'sidehill';
        }
      }
    }
    
    return primaryDirection;
  }
  
  /**
   * Classify green slope along ball-to-pin line
   */
  async classifyGreenSlope(ballLon, ballLat, pinLon, pinLat) {
    // Sample green area along the line of play
    const slope = await this.calculateSlopeVector(ballLon, ballLat, pinLon, pinLat);
    
    if (Math.abs(slope.slopePercent) < 2) {
      return 'flat';
    } else if (slope.slopePercent > 0) {
      return 'uphill'; // Green runs toward you
    } else {
      return 'downhill'; // Green runs away from you
    }
  }
  
  /**
   * Classify elevation change (macro ball to pin)
   */
  async classifyElevationChange(ballLon, ballLat, pinLon, pinLat) {
    try {
      // Sample elevations at ball and pin positions
      const ballPos = [Cesium.Cartographic.fromDegrees(ballLon, ballLat)];
      const pinPos = [Cesium.Cartographic.fromDegrees(pinLon, pinLat)];
      
      const [ballSample] = await Cesium.sampleTerrainMostDetailed(this.viewer.terrainProvider, ballPos);
      const [pinSample] = await Cesium.sampleTerrainMostDetailed(this.viewer.terrainProvider, pinPos);
      
      const elevationDiff = (pinSample.height || 0) - (ballSample.height || 0);
      
      if (Math.abs(elevationDiff) <= 1) {
        return 'flat';
      } else if (elevationDiff > 1) {
        return 'uphill';
      } else {
        return 'downhill';
      }
    } catch (error) {
      console.warn('Error classifying elevation change:', error);
      return 'flat';
    }
  }
  
  /**
   * Calculate green percentage (usable landing depth)
   */
  calculateGreenPercentage(ballLon, ballLat, pinLon, pinLat) {
    // Get green polygon from cache
    const cache = this.courseFeatureCache;
    if (!cache || !cache.greenPolygon) {
      return '>45%'; // Default to ample green if no polygon
    }
    
    // Calculate total ball-to-pin distance
    const totalDistance = this.calculateDistance(ballLon, ballLat, pinLon, pinLat) * 1000; // meters
    
    // Find where ball-to-pin line intersects green boundary
    const lineVector = {
      dx: pinLon - ballLon,
      dy: pinLat - ballLat
    };
    
    // Find green entry point (first intersection from ball toward pin)
    let greenEntryDistance = 0;
    const steps = 100;
    
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const testLon = ballLon + t * lineVector.dx;
      const testLat = ballLat + t * lineVector.dy;
      
      if (this.pointInPolyDeg(testLon, testLat, cache.greenPolygon)) {
        greenEntryDistance = t * totalDistance;
        break;
      }
    }
    
    // Calculate usable green depth (green entry to pin)
    const usableGreenDepth = totalDistance - greenEntryDistance;
    const greenPercentage = (usableGreenDepth / totalDistance) * 100;
    
    if (greenPercentage < 20) {
      return '<20%';
    } else if (greenPercentage <= 45) {
      return '20-45%';
    } else {
      return '>45%';
    }
  }
  
  /**
   * Get short game modifier for given conditions
   */
  getShortGameModifier(ballLie, greenSlope, elevationChange, greenPercent) {
    if (!this.shortGameModifiers) {
      return { modifier: 0, difficulty: 5, rationale: 'Modifiers not loaded' };
    }
    
    // Create lookup key (note: need to handle spacing in original data)
    const key = `${ballLie}_${greenSlope}_${elevationChange}_${greenPercent}`;
    const result = this.shortGameModifiers[key];
    
    if (result) {
      return result;
    }
    
    // If exact match not found, try variations with spaces
    const variations = [
      `${ballLie}_ ${greenSlope}_ ${elevationChange}_${greenPercent}`,
      `${ballLie}_${greenSlope}_ ${elevationChange}_${greenPercent}`,
      `${ballLie}_ ${greenSlope}_${elevationChange}_${greenPercent}`
    ];
    
    for (const variant of variations) {
      if (this.shortGameModifiers[variant]) {
        return this.shortGameModifiers[variant];
      }
    }
    
    console.warn(`No modifier found for: ${key}`);
    return { modifier: 0, difficulty: 5, rationale: 'No matching condition' };
  }
  
  /**
   * Calculate advanced expected strokes with short game modifiers
   */
  async calculateAdvancedExpectedStrokes(distanceYards, ballLon, ballLat, pinLon, pinLat) {
    // Start with base calculation
    const courseFeature = this.identifyCourseFeature(ballLon, ballLat);
    const baseStrokes = this.calculateExpectedStrokes(distanceYards, courseFeature);
    
    // Apply advanced modifiers only for short game (≤45 yards) and when enabled
    if (!this.advancedModeEnabled || distanceYards > 45) {
      return baseStrokes;
    }
    
    try {
      // Classify all conditions
      const ballLie = await this.classifyBallLie(ballLon, ballLat, pinLon, pinLat);
      const greenSlope = await this.classifyGreenSlope(ballLon, ballLat, pinLon, pinLat);
      const elevationChange = await this.classifyElevationChange(ballLon, ballLat, pinLon, pinLat);
      const greenPercent = this.calculateGreenPercentage(ballLon, ballLat, pinLon, pinLat);
      
      // Get modifier
      const modifierData = this.getShortGameModifier(ballLie, greenSlope, elevationChange, greenPercent);
      
      // Apply modifier to base strokes
      const finalStrokes = baseStrokes + modifierData.modifier;
      
      if (this.DEBUG_MODE) {
        console.log(`Advanced short game: ${distanceYards.toFixed(1)}y, ${ballLie}/${greenSlope}/${elevationChange}/${greenPercent} = ${baseStrokes.toFixed(2)} + ${modifierData.modifier.toFixed(2)} = ${finalStrokes.toFixed(2)}`);
      }
      
      return Math.max(1.0, finalStrokes); // Ensure minimum 1 stroke
      
    } catch (error) {
      console.warn('Error in advanced expected strokes calculation:', error);
      return baseStrokes;
    }
  }
}

// Export the modules for use in dashboard
window.AICaddieGolfModule = AICaddieGolfModule;
window.SlopeAnalysisModule = SlopeAnalysisModule;

console.log('AI-Caddie Golf Module loaded successfully');