/**
 * Skill Rating Engine for DataGolf-Style 0-100 Skill Ratings
 * 
 * Converts strokes gained performance into intuitive 0-100 ratings
 * across 7 key golf skill categories, matching DataGolf methodology
 */

class SkillRatingEngine {
  constructor(shotDataModel) {
    this.shotDataModel = shotDataModel;
    
    // PGA Tour baseline statistics (strokes gained per shot averages)
    // These represent the "50" rating baseline for each skill
    this.tourBaselines = {
      drivingDistance: {
        averageDistance: 296.5, // Tour average driving distance
        standardDeviation: 12.5
      },
      drivingAccuracy: {
        fairwayPercentage: 0.61, // Tour average fairway percentage
        standardDeviation: 0.08
      },
      totalDriving: {
        strokesGained: 0.0, // Tour baseline is 0 by definition
        standardDeviation: 0.35
      },
      approachShots: {
        strokesGained: 0.0,
        standardDeviation: 0.45,
        distanceBins: {
          '50-100': { baseline: 0.0, stdDev: 0.25 },
          '100-125': { baseline: 0.0, stdDev: 0.30 },
          '125-150': { baseline: 0.0, stdDev: 0.35 },
          '150-175': { baseline: 0.0, stdDev: 0.40 },
          '175-200': { baseline: 0.0, stdDev: 0.45 },
          '200+': { baseline: 0.0, stdDev: 0.50 }
        }
      },
      aroundTheGreen: {
        strokesGained: 0.0,
        standardDeviation: 0.40
      },
      shortRangePutting: {
        strokesGained: 0.0, // 0-8 feet
        standardDeviation: 0.25,
        distanceBins: {
          '0-3': { baseline: 0.0, stdDev: 0.15 },
          '3-5': { baseline: 0.0, stdDev: 0.20 },
          '5-8': { baseline: 0.0, stdDev: 0.25 }
        }
      },
      mediumLongPutting: {
        strokesGained: 0.0, // 8+ feet
        standardDeviation: 0.30,
        distanceBins: {
          '8-15': { baseline: 0.0, stdDev: 0.25 },
          '15-25': { baseline: 0.0, stdDev: 0.30 },
          '25+': { baseline: 0.0, stdDev: 0.35 }
        }
      }
    };
    
    // Rating scale configuration
    this.ratingScale = {
      min: 0,
      max: 100,
      tourAverage: 50, // PGA Tour average = 50 rating
      standardDeviations: 2.5 // How many std devs from tour average = 0 or 100
    };
    
    console.log('Skill Rating Engine initialized');
  }

  /**
   * Calculate all skill ratings for a player
   * @param {string} roundId - Specific round ID (optional)
   * @returns {Object} Complete skill ratings (0-100 scale)
   */
  calculateAllSkillRatings(roundId = null) {
    const ratings = {
      drivingDistance: this.calculateDrivingDistance(roundId),
      drivingAccuracy: this.calculateDrivingAccuracy(roundId),
      totalDriving: this.calculateTotalDriving(roundId),
      approachShots: this.calculateApproachShots(roundId),
      aroundTheGreen: this.calculateAroundTheGreen(roundId),
      shortRangePutting: this.calculateShortRangePutting(roundId),
      mediumLongPutting: this.calculateMediumLongPutting(roundId),
      confidence: this.calculateConfidenceLevels(roundId)
    };
    
    // Add overall rating (weighted average)
    ratings.overall = this.calculateOverallRating(ratings);
    
    return ratings;
  }

  /**
   * Calculate driving distance rating (0-100)
   * Based on average driving distance vs tour baseline
   */
  calculateDrivingDistance(roundId = null) {
    const drivingShots = this.shotDataModel.getShotsByCategory('driving', roundId);
    
    if (drivingShots.length < this.shotDataModel.minimumShotsRequired.drivingDistance) {
      return {
        rating: null,
        confidence: 'insufficient_data',
        sampleSize: drivingShots.length,
        requiredShots: this.shotDataModel.minimumShotsRequired.drivingDistance
      };
    }
    
    // Calculate average driving distance
    const distances = drivingShots
      .filter(shot => shot.distances.totalDistance !== null)
      .map(shot => shot.distances.totalDistance);
    
    if (distances.length === 0) {
      return { rating: null, confidence: 'no_distance_data', sampleSize: 0 };
    }
    
    const averageDistance = distances.reduce((sum, dist) => sum + dist, 0) / distances.length;
    
    // Convert to 0-100 rating using tour baseline
    const baseline = this.tourBaselines.drivingDistance;
    const standardScore = (averageDistance - baseline.averageDistance) / baseline.standardDeviation;
    const rating = this.convertStandardScoreToRating(standardScore);
    
    return {
      rating: Math.round(rating),
      averageDistance: Math.round(averageDistance),
      vsBaseline: Math.round(averageDistance - baseline.averageDistance),
      confidence: this.calculateConfidence(distances.length, this.shotDataModel.minimumShotsRequired.drivingDistance),
      sampleSize: distances.length
    };
  }

  /**
   * Calculate driving accuracy rating (0-100)
   * Based on fairway hit percentage
   */
  calculateDrivingAccuracy(roundId = null) {
    const drivingShots = this.shotDataModel.getShotsByCategory('driving', roundId);
    
    if (drivingShots.length < this.shotDataModel.minimumShotsRequired.drivingAccuracy) {
      return {
        rating: null,
        confidence: 'insufficient_data',
        sampleSize: drivingShots.length
      };
    }
    
    // Calculate fairway hit percentage
    const applicableShots = drivingShots.filter(shot => shot.result.fairwayHit !== null);
    
    if (applicableShots.length === 0) {
      return { rating: null, confidence: 'no_accuracy_data', sampleSize: 0 };
    }
    
    const fairwayHits = applicableShots.filter(shot => shot.result.fairwayHit === true).length;
    const fairwayPercentage = fairwayHits / applicableShots.length;
    
    // Convert to 0-100 rating
    const baseline = this.tourBaselines.drivingAccuracy;
    const standardScore = (fairwayPercentage - baseline.fairwayPercentage) / baseline.standardDeviation;
    const rating = this.convertStandardScoreToRating(standardScore);
    
    return {
      rating: Math.round(rating),
      fairwayPercentage: Math.round(fairwayPercentage * 100),
      fairwayHits,
      totalShots: applicableShots.length,
      confidence: this.calculateConfidence(applicableShots.length, this.shotDataModel.minimumShotsRequired.drivingAccuracy),
      sampleSize: applicableShots.length
    };
  }

  /**
   * Calculate total driving rating (0-100)
   * Based on strokes gained off the tee (combines distance + accuracy value)
   */
  calculateTotalDriving(roundId = null) {
    const drivingShots = this.shotDataModel.getShotsByCategory('driving', roundId);
    
    if (drivingShots.length < this.shotDataModel.minimumShotsRequired.totalDriving) {
      return {
        rating: null,
        confidence: 'insufficient_data',
        sampleSize: drivingShots.length
      };
    }
    
    // Calculate average strokes gained off the tee
    const strokesGainedValues = drivingShots
      .filter(shot => shot.expectedStrokes.gained !== null)
      .map(shot => shot.expectedStrokes.gained);
    
    if (strokesGainedValues.length === 0) {
      return { rating: null, confidence: 'no_strokes_gained_data', sampleSize: 0 };
    }
    
    const averageStrokesGained = strokesGainedValues.reduce((sum, sg) => sum + sg, 0) / strokesGainedValues.length;
    
    // Convert to 0-100 rating
    const baseline = this.tourBaselines.totalDriving;
    const standardScore = (averageStrokesGained - baseline.strokesGained) / baseline.standardDeviation;
    const rating = this.convertStandardScoreToRating(standardScore);
    
    return {
      rating: Math.round(rating),
      strokesGained: parseFloat(averageStrokesGained.toFixed(3)),
      confidence: this.calculateConfidence(strokesGainedValues.length, this.shotDataModel.minimumShotsRequired.totalDriving),
      sampleSize: strokesGainedValues.length
    };
  }

  /**
   * Calculate approach shots rating (0-100)
   * Based on strokes gained on approach shots
   */
  calculateApproachShots(roundId = null) {
    const approachShots = this.shotDataModel.getShotsByCategory('approach', roundId);
    
    if (approachShots.length < this.shotDataModel.minimumShotsRequired.approachShots) {
      return {
        rating: null,
        confidence: 'insufficient_data',
        sampleSize: approachShots.length
      };
    }
    
    // Calculate average strokes gained on approach
    const strokesGainedValues = approachShots
      .filter(shot => shot.expectedStrokes.gained !== null)
      .map(shot => shot.expectedStrokes.gained);
    
    if (strokesGainedValues.length === 0) {
      return { rating: null, confidence: 'no_strokes_gained_data', sampleSize: 0 };
    }
    
    const averageStrokesGained = strokesGainedValues.reduce((sum, sg) => sum + sg, 0) / strokesGainedValues.length;
    
    // Convert to 0-100 rating
    const baseline = this.tourBaselines.approachShots;
    const standardScore = (averageStrokesGained - baseline.strokesGained) / baseline.standardDeviation;
    const rating = this.convertStandardScoreToRating(standardScore);
    
    // Calculate distance bin breakdown
    const distanceBins = this.calculateApproachByDistance(approachShots);
    
    return {
      rating: Math.round(rating),
      strokesGained: parseFloat(averageStrokesGained.toFixed(3)),
      distanceBins,
      confidence: this.calculateConfidence(strokesGainedValues.length, this.shotDataModel.minimumShotsRequired.approachShots),
      sampleSize: strokesGainedValues.length
    };
  }

  /**
   * Calculate around the green rating (0-100)
   * Based on strokes gained within 45 yards
   */
  calculateAroundTheGreen(roundId = null) {
    const shortGameShots = this.shotDataModel.getShotsByCategory('shortGame', roundId);
    
    if (shortGameShots.length < this.shotDataModel.minimumShotsRequired.aroundTheGreen) {
      return {
        rating: null,
        confidence: 'insufficient_data',
        sampleSize: shortGameShots.length
      };
    }
    
    // Calculate average strokes gained around the green
    const strokesGainedValues = shortGameShots
      .filter(shot => shot.expectedStrokes.gained !== null)
      .map(shot => shot.expectedStrokes.gained);
    
    if (strokesGainedValues.length === 0) {
      return { rating: null, confidence: 'no_strokes_gained_data', sampleSize: 0 };
    }
    
    const averageStrokesGained = strokesGainedValues.reduce((sum, sg) => sum + sg, 0) / strokesGainedValues.length;
    
    // Convert to 0-100 rating
    const baseline = this.tourBaselines.aroundTheGreen;
    const standardScore = (averageStrokesGained - baseline.strokesGained) / baseline.standardDeviation;
    const rating = this.convertStandardScoreToRating(standardScore);
    
    return {
      rating: Math.round(rating),
      strokesGained: parseFloat(averageStrokesGained.toFixed(3)),
      confidence: this.calculateConfidence(strokesGainedValues.length, this.shotDataModel.minimumShotsRequired.aroundTheGreen),
      sampleSize: strokesGainedValues.length
    };
  }

  /**
   * Calculate short range putting rating (0-100)
   * Based on strokes gained putting 0-8 feet
   */
  calculateShortRangePutting(roundId = null) {
    const puttingShots = this.shotDataModel.getShotsByCategory('putting', roundId);
    const shortPutts = puttingShots.filter(shot =>
      shot.distances.distanceToTarget !== null &&
      shot.distances.distanceToTarget <= 8
    );
    
    if (shortPutts.length < this.shotDataModel.minimumShotsRequired.shortRangePutting) {
      return {
        rating: null,
        confidence: 'insufficient_data',
        sampleSize: shortPutts.length
      };
    }
    
    // Calculate average strokes gained on short putts
    const strokesGainedValues = shortPutts
      .filter(shot => shot.expectedStrokes.gained !== null)
      .map(shot => shot.expectedStrokes.gained);
    
    if (strokesGainedValues.length === 0) {
      return { rating: null, confidence: 'no_strokes_gained_data', sampleSize: 0 };
    }
    
    const averageStrokesGained = strokesGainedValues.reduce((sum, sg) => sum + sg, 0) / strokesGainedValues.length;
    
    // Convert to 0-100 rating
    const baseline = this.tourBaselines.shortRangePutting;
    const standardScore = (averageStrokesGained - baseline.strokesGained) / baseline.standardDeviation;
    const rating = this.convertStandardScoreToRating(standardScore);
    
    return {
      rating: Math.round(rating),
      strokesGained: parseFloat(averageStrokesGained.toFixed(3)),
      confidence: this.calculateConfidence(strokesGainedValues.length, this.shotDataModel.minimumShotsRequired.shortRangePutting),
      sampleSize: strokesGainedValues.length
    };
  }

  /**
   * Calculate medium/long range putting rating (0-100)
   * Based on strokes gained putting 8+ feet
   */
  calculateMediumLongPutting(roundId = null) {
    const puttingShots = this.shotDataModel.getShotsByCategory('putting', roundId);
    const longPutts = puttingShots.filter(shot =>
      shot.distances.distanceToTarget !== null &&
      shot.distances.distanceToTarget > 8
    );
    
    if (longPutts.length < this.shotDataModel.minimumShotsRequired.mediumLongPutting) {
      return {
        rating: null,
        confidence: 'insufficient_data',
        sampleSize: longPutts.length
      };
    }
    
    // Calculate average strokes gained on long putts
    const strokesGainedValues = longPutts
      .filter(shot => shot.expectedStrokes.gained !== null)
      .map(shot => shot.expectedStrokes.gained);
    
    if (strokesGainedValues.length === 0) {
      return { rating: null, confidence: 'no_strokes_gained_data', sampleSize: 0 };
    }
    
    const averageStrokesGained = strokesGainedValues.reduce((sum, sg) => sum + sg, 0) / strokesGainedValues.length;
    
    // Convert to 0-100 rating
    const baseline = this.tourBaselines.mediumLongPutting;
    const standardScore = (averageStrokesGained - baseline.strokesGained) / baseline.standardDeviation;
    const rating = this.convertStandardScoreToRating(standardScore);
    
    return {
      rating: Math.round(rating),
      strokesGained: parseFloat(averageStrokesGained.toFixed(3)),
      confidence: this.calculateConfidence(strokesGainedValues.length, this.shotDataModel.minimumShotsRequired.mediumLongPutting),
      sampleSize: strokesGainedValues.length
    };
  }

  /**
   * Convert standard score (z-score) to 0-100 rating
   * @param {number} standardScore - Z-score relative to tour baseline
   * @returns {number} Rating (0-100)
   */
  convertStandardScoreToRating(standardScore) {
    // Clamp standard score to reasonable range
    const clampedScore = Math.max(-this.ratingScale.standardDeviations, 
                                  Math.min(this.ratingScale.standardDeviations, standardScore));
    
    // Convert to 0-100 scale (50 = tour average)
    const rating = this.ratingScale.tourAverage + 
                   (clampedScore / this.ratingScale.standardDeviations) * 
                   (this.ratingScale.max - this.ratingScale.tourAverage);
    
    return Math.max(this.ratingScale.min, Math.min(this.ratingScale.max, rating));
  }

  /**
   * Calculate confidence level based on sample size
   * @param {number} sampleSize - Number of shots
   * @param {number} minimumRequired - Minimum shots required
   * @returns {string} Confidence level
   */
  calculateConfidence(sampleSize, minimumRequired) {
    if (sampleSize < minimumRequired) return 'insufficient';
    if (sampleSize < minimumRequired * 2) return 'low';
    if (sampleSize < minimumRequired * 4) return 'medium';
    return 'high';
  }

  /**
   * Calculate confidence levels for all categories
   * @param {string} roundId - Round ID
   * @returns {Object} Confidence levels
   */
  calculateConfidenceLevels(roundId = null) {
    return {
      drivingDistance: this.calculateConfidence(
        this.shotDataModel.getShotsByCategory('driving', roundId).length,
        this.shotDataModel.minimumShotsRequired.drivingDistance
      ),
      drivingAccuracy: this.calculateConfidence(
        this.shotDataModel.getShotsByCategory('driving', roundId).length,
        this.shotDataModel.minimumShotsRequired.drivingAccuracy
      ),
      totalDriving: this.calculateConfidence(
        this.shotDataModel.getShotsByCategory('driving', roundId).length,
        this.shotDataModel.minimumShotsRequired.totalDriving
      ),
      approachShots: this.calculateConfidence(
        this.shotDataModel.getShotsByCategory('approach', roundId).length,
        this.shotDataModel.minimumShotsRequired.approachShots
      ),
      aroundTheGreen: this.calculateConfidence(
        this.shotDataModel.getShotsByCategory('shortGame', roundId).length,
        this.shotDataModel.minimumShotsRequired.aroundTheGreen
      ),
      shortRangePutting: this.calculateConfidence(
        this.shotDataModel.getShotsByCategory('putting', roundId).filter(s => s.distances.distanceToTarget <= 8).length,
        this.shotDataModel.minimumShotsRequired.shortRangePutting
      ),
      mediumLongPutting: this.calculateConfidence(
        this.shotDataModel.getShotsByCategory('putting', roundId).filter(s => s.distances.distanceToTarget > 8).length,
        this.shotDataModel.minimumShotsRequired.mediumLongPutting
      )
    };
  }

  /**
   * Calculate overall rating (weighted average of all skills)
   * @param {Object} ratings - Individual skill ratings
   * @returns {number} Overall rating
   */
  calculateOverallRating(ratings) {
    const weights = {
      drivingDistance: 0.15,
      drivingAccuracy: 0.10,
      totalDriving: 0.20,
      approachShots: 0.25,
      aroundTheGreen: 0.15,
      shortRangePutting: 0.10,
      mediumLongPutting: 0.05
    };
    
    let weightedSum = 0;
    let totalWeight = 0;
    
    Object.keys(weights).forEach(skill => {
      if (ratings[skill] && ratings[skill].rating !== null) {
        weightedSum += ratings[skill].rating * weights[skill];
        totalWeight += weights[skill];
      }
    });
    
    return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : null;
  }

  /**
   * Calculate approach shots performance by distance bins
   * @param {Array} approachShots - Approach shots data
   * @returns {Object} Performance by distance
   */
  calculateApproachByDistance(approachShots) {
    const bins = {
      '50-100': [],
      '100-125': [],
      '125-150': [],
      '150-175': [],
      '175-200': [],
      '200+': []
    };
    
    approachShots.forEach(shot => {
      const distance = shot.distances.distanceToTarget;
      if (distance === null) return;
      
      if (distance <= 100) bins['50-100'].push(shot);
      else if (distance <= 125) bins['100-125'].push(shot);
      else if (distance <= 150) bins['125-150'].push(shot);
      else if (distance <= 175) bins['150-175'].push(shot);
      else if (distance <= 200) bins['175-200'].push(shot);
      else bins['200+'].push(shot);
    });
    
    const results = {};
    Object.keys(bins).forEach(bin => {
      const shots = bins[bin];
      if (shots.length > 0) {
        const strokesGained = shots
          .filter(s => s.expectedStrokes.gained !== null)
          .map(s => s.expectedStrokes.gained);
        
        results[bin] = {
          sampleSize: shots.length,
          strokesGained: strokesGained.length > 0 ? 
            parseFloat((strokesGained.reduce((sum, sg) => sum + sg, 0) / strokesGained.length).toFixed(3)) : 
            null
        };
      }
    });
    
    return results;
  }
}

// Global instance - will be initialized when shotDataModel is available
window.skillRatingEngine = null;

// Initialize when shotDataModel is ready
document.addEventListener('DOMContentLoaded', function() {
  if (window.shotDataModel) {
    window.skillRatingEngine = new SkillRatingEngine(window.shotDataModel);
    console.log('Skill Rating Engine initialized with Shot Data Model');
  }
});

console.log('Skill Rating Engine class loaded successfully');