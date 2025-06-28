import pandas as pd
import numpy as np
from sklearn.linear_model import LinearRegression
from sklearn.model_selection import cross_val_score
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline
import joblib
import os

def preprocess_data(df):
    """
    Preprocess the FlightScope data for ML training.
    Converts columns to numeric, assuming direction fields are already positive/negative.
    Returns: Processed features (X), targets (y), and feature names.
    """
    # Copy dataframe to avoid modifying original
    df = df.copy()
    
    # Convert direction fields to numeric (already positive/negative for left/right)
    for col in ['Spin Axis (deg)', 'Lateral (yd)', 'Launch H (deg)']:
        df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0.0)
    
    # Convert other numeric columns
    for col in ['Ball (mph)', 'Launch V (deg)', 'Spin (rpm)', 'Carry (yd)', 'Height (ft)']:
        df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0.0)
    
    # Define features and targets (exclude constant features)
    features = ['Ball (mph)', 'Launch V (deg)', 'Launch H (deg)', 'Spin (rpm)', 'Spin Axis (deg)']
    targets = ['Carry (yd)', 'Lateral (yd)', 'Height (ft)']
    
    # Check for missing columns
    missing_cols = [col for col in features + targets if col not in df.columns]
    if missing_cols:
        raise ValueError(f"Missing columns in data: {missing_cols}")
    
    # Check for missing values
    if df[features + targets].isna().any().any():
        print(f"Warning: Missing values found in data. Filled with 0.0.")
    
    # Warn if dataset is small
    if len(df) < 50:
        print(f"Warning: Small dataset ({len(df)} rows). Consider adding more data for better model performance.")
    
    X = df[features]
    y = df[targets]
    
    # Verify target shape
    if y.shape[1] != len(targets):
        raise ValueError(f"Expected {len(targets)} target columns, got {y.shape[1]}")
    
    return X, y, features

def train_model(X, y):
    """
    Train a Linear Regression model with feature scaling and cross-validation.
    Returns: Trained model, scaler, and performance metrics.
    """
    # Initialize model with feature scaling
    scaler = StandardScaler()
    model = make_pipeline(scaler, LinearRegression())
    
    # Initialize lists for scores
    mse_scores = []
    r2_scores = []
    
    # Perform 5-fold cross-validation for each target
    for i in range(y.shape[1]):
        mse = -cross_val_score(model, X, y.iloc[:, i], cv=5, scoring='neg_mean_squared_error')
        r2 = cross_val_score(model, X, y.iloc[:, i], cv=5, scoring='r2')
        mse_scores.append(np.mean(mse))
        r2_scores.append(np.mean(r2))
    
    # Train model on full data
    model.fit(X, y)
    
    return model, scaler, np.array(mse_scores), np.array(r2_scores)

def main():
    # File path
    data_path = "/Users/jacksonne/Python Projects/AI_Caddie/AI_Caddie/Shot_Data/random_flightscope_data.csv"
    
    # Load data
    if not os.path.exists(data_path):
        print(f"Error: {data_path} not found. Please provide the CSV file.")
        input("Press Enter to exit.")
        exit(1)
    
    df = pd.read_csv(data_path)
    print(f"Loaded {len(df)} rows from {data_path}")
    
    # Preprocess data
    try:
        X, y, feature_names = preprocess_data(df)
    except ValueError as e:
        print(f"Error in preprocessing: {e}")
        input("Press Enter to exit.")
        exit(1)
    
    # Train model
    try:
        model, scaler, mse, r2 = train_model(X, y)
    except ValueError as e:
        print(f"Error in training: {e}. Likely too few samples for cross-validation.")
        input("Press Enter to exit.")
        exit(1)
    
    # Print performance
    print("\nModel Performance (5-fold Cross-Validation):")
    for i, target in enumerate(['Carry (yd)', 'Lateral (yd)', 'Height (ft)']):
        print(f"{target}: MSE = {mse[i]:.2f}, R² = {r2[i]:.2f}")
    
    # Save model and scaler
    model_path = "/Users/jacksonne/Python Projects/AI_Caddie/AI_Caddie/golf_trajectory_model.joblib"
    scaler_path = "/Users/jacksonne/Python Projects/AI_Caddie/AI_Caddie/scaler.joblib"
    joblib.dump(model, model_path)
    joblib.dump(scaler, scaler_path)
    print(f"\nSaved model to {model_path}")
    print(f"Saved scaler to {scaler_path}")
    
    # Example prediction
    example_input = X.iloc[0:1].copy()
    prediction = model.predict(example_input)
    print("\nExample Prediction:")
    print(f"Input: {example_input.to_dict(orient='records')[0]}")
    print(f"Predicted: Carry = {prediction[0][0]:.1f} yd, Lateral = {prediction[0][1]:.1f} yd, Height = {prediction[0][2]:.1f} ft")

if __name__ == "__main__":
    main()