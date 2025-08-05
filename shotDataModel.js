/**
 * Shot Data Model for DataGolf-Style Skill Ratings
 * 
 * Comprehensive data structure for capturing shot-level information
 * needed to calculate 0-100 skill ratings across all golf skills
 */

class ShotDataModel {
  constructor() {
    this.rounds = new Map();
    this.skillCategories = {
      drivingDistance: 0,
      drivingAccuracy: 0,
      totalDriving: 0,
      approachShots: 0,
      aroundTheGreen: 0,
      shortRangePutting: 0,
      mediumLongPutting: 0
    };
    
    this.minimumShotsRequired = {
      drivingDistance: 10,
      drivingAccuracy: 10,
      totalDriving: 10,
      approachShots: 20,
      aroundTheGreen: 15,
      shortRangePutting: 10,
      mediumLongPutting: 10
    };
    
    console.log('Shot Data Model initialized');
  }

  /**
   * Create a new round data structure
   * @param {string} courseId - Course identifier
   * @param {string} courseName - Course name
   * @param {Date} date - Round date
   * @param {Object} conditions - Course/weather conditions
   * @returns {Object} Round data structure
   */
  createRound(courseId, courseName, date = new Date(), conditions = {}) {
    const roundId = this.generateRoundId();
    
    const roundData = {
      roundId,
      courseId,
      courseName,
      date: date.toISOString(),
      conditions: {
        temperature: conditions.temperature || null,
        windSpeed: conditions.windSpeed || null,
        windDirection: conditions.windDirection || null,
        courseFirmness: conditions.courseFirmness || 'medium',
        greenSpeed: conditions.greenSpeed || null,
        ...conditions
      },
      holes: new Map(),
      totalScore: 0,
      strokesGained: {
        offTheTee: 0,
        approach: 0,
        aroundTheGreen: 0,
        putting: 0,
        total: 0
      },
      skillRatings: { ...this.skillCategories },
      completed: false
    };
    
    this.rounds.set(roundId, roundData);
    return roundData;
  }

  /**
   * Create a new hole data structure
   * @param {string} roundId - Round identifier
   * @param {number} holeNumber - Hole number (1-18)
   * @param {Object} holeInfo - Hole information
   * @returns {Object} Hole data structure
   */
  createHole(roundId, holeNumber, holeInfo = {}) {
    const holeData = {
      holeNumber,
      par: holeInfo.par || 4,
      yardage: holeInfo.yardage || null,
      handicap: holeInfo.handicap || null,
      pinPosition: holeInfo.pinPosition || null, // {lat, lon, distanceFromCenter}
      shots: [],
      score: 0,
      strokesGained: {
        offTheTee: 0,
        approach: 0,
        aroundTheGreen: 0,
        putting: 0,
        total: 0
      },
      completed: false
    };
    
    const round = this.rounds.get(roundId);
    if (round) {
      round.holes.set(holeNumber, holeData);
    }
    
    return holeData;
  }

  /**
   * Create a comprehensive shot data structure
   * @param {Object} shotInfo - Shot information
   * @returns {Object} Shot data structure
   */
  createShot(shotInfo) {
    const shot = {
      // Basic shot identification
      shotId: this.generateShotId(),
      shotNumber: shotInfo.shotNumber || 1,
      timestamp: new Date().toISOString(),
      
      // Position data (starting position)
      startPosition: {
        lat: shotInfo.startLat,
        lon: shotInfo.startLon,
        elevation: shotInfo.startElevation || null,
        courseFeature: shotInfo.startCourseFeature || 'rough', // fairway, rough, tee, green, sand, water, recovery
        lie: shotInfo.lie || 'normal' // normal, uphill, downhill, sidehill, buried, etc.
      },
      
      // Position data (ending position)
      endPosition: {
        lat: shotInfo.endLat,
        lon: shotInfo.endLon,
        elevation: shotInfo.endElevation || null,
        courseFeature: shotInfo.endCourseFeature || 'rough',
        lie: shotInfo.endLie || 'normal'
      },
      
      // Distance measurements
      distances: {
        carriedDistance: shotInfo.carriedDistance || null,
        totalDistance: shotInfo.totalDistance || null,
        distanceToTarget: shotInfo.distanceToTarget || null, // Distance to pin/target at start
        distanceToTargetAfter: shotInfo.distanceToTargetAfter || null, // Distance to pin/target after shot
        lateralMiss: shotInfo.lateralMiss || null // Left/right miss in yards (+ = right, - = left)
      },
      
      // Club and shot execution
      club: {
        type: shotInfo.clubType || null, // driver, 3-wood, 7-iron, pw, putter, etc.
        loft: shotInfo.clubLoft || null,
        category: this.categorizeClub(shotInfo.clubType)
      },
      
      // Shot result and quality
      result: {
        quality: shotInfo.shotQuality || 'average', // great, good, average, poor, terrible
        outcome: shotInfo.outcome || 'fairway', // fairway, rough, green, sand, water, ob, etc.
        greenInRegulation: shotInfo.greenInRegulation || false,
        fairwayHit: shotInfo.fairwayHit || null, // true/false/null (not applicable)
        ballSpeed: shotInfo.ballSpeed || null, // For driving distance calculations
        spinRate: shotInfo.spinRate || null
      },
      
      // Expected strokes analysis
      expectedStrokes: {
        before: shotInfo.expectedStrokesBefore || null,
        after: shotInfo.expectedStrokesAfter || null,
        gained: null // Will be calculated
      },
      
      // Course conditions
      conditions: {
        windSpeed: shotInfo.windSpeed || null,
        windDirection: shotInfo.windDirection || null,
        temperature: shotInfo.temperature || null,
        courseFirmness: shotInfo.courseFirmness || 'medium',
        greenSpeed: shotInfo.greenSpeed || null
      },
      
      // Short game specific (for ≤45 yard shots)
      shortGame: {
        ballLie: shotInfo.ballLie || null,
        greenSlope: shotInfo.greenSlope || null,
        pinDistance: shotInfo.pinDistance || null,
        shortGameModifier: shotInfo.shortGameModifier || null
      }
    };
    
    // Calculate strokes gained
    if (shot.expectedStrokes.before !== null && shot.expectedStrokes.after !== null) {
      shot.expectedStrokes.gained = shot.expectedStrokes.before - shot.expectedStrokes.after - 1;
    }
    
    return shot;
  }

  /**
   * Add shot to hole
   * @param {string} roundId - Round identifier
   * @param {number} holeNumber - Hole number
   * @param {Object} shotData - Shot data
   */
  addShotToHole(roundId, holeNumber, shotData) {
    const round = this.rounds.get(roundId);
    if (!round) return false;
    
    const hole = round.holes.get(holeNumber);
    if (!hole) return false;
    
    // Add shot to hole
    hole.shots.push(shotData);
    
    // Update hole stroke count
    hole.score = hole.shots.length;
    
    // Update strokes gained for hole
    this.updateHoleStrokesGained(hole);
    
    return true;
  }

  /**
   * Update strokes gained calculations for a hole
   * @param {Object} hole - Hole data
   */
  updateHoleStrokesGained(hole) {
    let offTheTee = 0;
    let approach = 0;
    let aroundTheGreen = 0;
    let putting = 0;
    
    hole.shots.forEach((shot, index) => {
      if (shot.expectedStrokes.gained !== null) {
        // Categorize shot for strokes gained
        const category = this.categorizeStrokesGainedCategory(shot, index, hole.shots.length);
        
        switch (category) {
          case 'offTheTee':
            offTheTee += shot.expectedStrokes.gained;
            break;
          case 'approach':
            approach += shot.expectedStrokes.gained;
            break;
          case 'aroundTheGreen':
            aroundTheGreen += shot.expectedStrokes.gained;
            break;
          case 'putting':
            putting += shot.expectedStrokes.gained;
            break;
        }
      }
    });
    
    hole.strokesGained = {
      offTheTee,
      approach,
      aroundTheGreen,
      putting,
      total: offTheTee + approach + aroundTheGreen + putting
    };
  }

  /**
   * Categorize shot for strokes gained analysis
   * @param {Object} shot - Shot data
   * @param {number} shotIndex - Shot index in hole
   * @param {number} totalShots - Total shots in hole
   * @returns {string} Strokes gained category
   */
  categorizeStrokesGainedCategory(shot, shotIndex, totalShots) {
    // First shot from tee
    if (shotIndex === 0) {
      return 'offTheTee';
    }
    
    // Putts (shots from green)
    if (shot.startPosition.courseFeature === 'green') {
      return 'putting';
    }
    
    // Short game (≤45 yards to pin)
    if (shot.distances.distanceToTarget !== null && shot.distances.distanceToTarget <= 45) {
      return 'aroundTheGreen';
    }
    
    // Everything else is approach
    return 'approach';
  }

  /**
   * Categorize club type for analysis
   * @param {string} clubType - Club type
   * @returns {string} Club category
   */
  categorizeClub(clubType) {
    if (!clubType) return 'unknown';
    
    const club = clubType.toLowerCase();
    
    if (club.includes('driver')) return 'driver';
    if (club.includes('wood') || club.includes('hybrid')) return 'wood';
    if (club.includes('iron') || club.includes('pw') || club.includes('wedge')) return 'iron';
    if (club.includes('putter')) return 'putter';
    
    return 'unknown';
  }

  /**
   * Get shots by category for skill rating calculations
   * @param {string} roundId - Round identifier (optional, if null gets all rounds)
   * @param {string} category - Shot category
   * @returns {Array} Filtered shots
   */
  getShotsByCategory(category, roundId = null) {
    const rounds = roundId ? [this.rounds.get(roundId)] : Array.from(this.rounds.values());
    const shots = [];
    
    rounds.forEach(round => {
      if (!round) return;
      
      round.holes.forEach(hole => {
        hole.shots.forEach((shot, index) => {
          const shotCategory = this.categorizeStrokesGainedCategory(shot, index, hole.shots.length);
          
          switch (category) {
            case 'driving':
              if (shotCategory === 'offTheTee' && shot.club.category === 'driver') {
                shots.push(shot);
              }
              break;
            case 'approach':
              if (shotCategory === 'approach') {
                shots.push(shot);
              }
              break;
            case 'shortGame':
              if (shotCategory === 'aroundTheGreen') {
                shots.push(shot);
              }
              break;
            case 'putting':
              if (shotCategory === 'putting') {
                shots.push(shot);
              }
              break;
          }
        });
      });
    });
    
    return shots;
  }

  /**
   * Generate unique round ID
   * @returns {string} Round ID
   */
  generateRoundId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 9);
    return `round_${timestamp}_${random}`;
  }

  /**
   * Generate unique shot ID
   * @returns {string} Shot ID
   */
  generateShotId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 9);
    return `shot_${timestamp}_${random}`;
  }

  /**
   * Export round data for persistence
   * @param {string} roundId - Round identifier
   * @returns {Object} Serializable round data
   */
  exportRound(roundId) {
    const round = this.rounds.get(roundId);
    if (!round) return null;
    
    // Convert Maps to Objects for JSON serialization
    const exportData = {
      ...round,
      holes: Object.fromEntries(round.holes)
    };
    
    return exportData;
  }

  /**
   * Import round data from persistence
   * @param {Object} roundData - Round data to import
   */
  importRound(roundData) {
    // Convert holes back to Map
    const round = {
      ...roundData,
      holes: new Map(Object.entries(roundData.holes))
    };
    
    this.rounds.set(round.roundId, round);
  }

  /**
   * Get basic statistics for debugging/monitoring
   * @returns {Object} Statistics
   */
  getStatistics() {
    const totalRounds = this.rounds.size;
    let totalHoles = 0;
    let totalShots = 0;
    
    this.rounds.forEach(round => {
      totalHoles += round.holes.size;
      round.holes.forEach(hole => {
        totalShots += hole.shots.length;
      });
    });
    
    return {
      totalRounds,
      totalHoles,
      totalShots,
      averageShotsPerHole: totalHoles > 0 ? (totalShots / totalHoles).toFixed(2) : 0
    };
  }
}

// Global instance
window.shotDataModel = new ShotDataModel();

console.log('Shot Data Model loaded successfully');