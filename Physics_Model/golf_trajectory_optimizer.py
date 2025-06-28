import numpy as np
import pandas as pd
from scipy.optimize import minimize
import os

def adjust_trajectory(ball_speed_mph, launch_angle_deg, spin_rate_rpm, spin_axis_deg, launch_direction_deg,
                     wind_speed_mph, wind_direction_deg, temperature_f, humidity_percent, altitude_ft,
                     C_d, C_l_scale):
    """
    Calculate adjusted carry distance, side, and max height for a golf shot.
    
    Args:
        ball_speed_mph (float): Initial ball speed in mph.
        launch_angle_deg (float): Launch angle in degrees.
        spin_rate_rpm (float): Backspin rate in rpm.
        spin_axis_deg (float): Spin axis tilt in degrees (positive = fade, negative = draw).
        launch_direction_deg (float): Launch direction in degrees (positive = right, negative = left).
        wind_speed_mph (float): Wind speed in mph.
        wind_direction_deg (float): Wind direction in degrees (0 = tailwind, 180 = headwind, 90 = left-to-right).
        temperature_f (float): Temperature in Fahrenheit.
        humidity_percent (float): Humidity in percentage.
        altitude_ft (float): Altitude in feet.
        C_d (float): Drag coefficient.
        C_l_scale (float): Scaling factor for lift coefficient (C_l = C_l_scale * spin_rate_rpm).
    
    Returns:
        tuple: (carry_yards, side_ft, max_height_ft)
    """
    # Constants
    g = 9.81  # Gravity (m/s^2)
    ball_mass_kg = 0.04593  # Golf ball mass (kg)
    ball_radius_m = 0.021335  # Golf ball radius (m)
    A = np.pi * ball_radius_m**2  # Cross-sectional area (m^2)
    
    # Convert inputs to SI units
    ball_speed_ms = ball_speed_mph * 0.44704  # mph to m/s
    launch_angle_rad = np.radians(launch_angle_deg)
    launch_direction_rad = np.radians(launch_direction_deg)
    spin_rate_radps = spin_rate_rpm * 2 * np.pi / 60  # rpm to rad/s
    spin_axis_rad = np.radians(spin_axis_deg)
    
    # Lift coefficient
    C_l = C_l_scale * spin_rate_rpm
    
    # Air density (kg/m^3)
    temp_c = (temperature_f - 32) * 5/9
    pressure_mb = 1013.25 * np.exp(-0.00012 * altitude_ft * 0.3048)  # ft to m
    rho = 1.225 * (pressure_mb / 1013.25) * (288.15 / (temp_c + 273.15)) * (1 - 0.01 * humidity_percent / 100)
    
    # Initial velocity components
    v_x = ball_speed_ms * np.cos(launch_angle_rad)  # Forward
    v_y = ball_speed_ms * np.sin(launch_angle_rad)  # Vertical
    v_z = ball_speed_ms * np.sin(launch_direction_rad) * np.cos(launch_angle_rad)  # Lateral
    
    # Time step for numerical integration
    dt = 0.005  # seconds
    t = 0
    x, y, z = 0, 0, 0  # Initial position (m)
    max_height_m = 0  # Track max height
    
    # Simulate trajectory
    while y >= 0:
        # Relative velocity including wind
        wind_x_ms = wind_speed_mph * 0.44704 * np.cos(np.radians(wind_direction_deg))
        wind_z_ms = wind_speed_mph * 0.44704 * np.sin(np.radians(wind_direction_deg))
        v_rel_x = v_x - wind_x_ms
        v_rel_z = v_z - wind_z_ms
        v_mag = np.sqrt(v_rel_x**2 + v_y**2 + v_rel_z**2)
        
        # Drag force
        F_d = 0.5 * rho * C_d * A * v_mag**2
        F_d_x = -F_d * v_rel_x / v_mag if v_mag > 0 else 0
        F_d_y = -F_d * v_y / v_mag if v_mag > 0 else 0
        F_d_z = -F_d * v_rel_z / v_mag if v_mag > 0 else 0
        
        # Lift force (Magnus effect)
        F_l = 0.5 * rho * C_l * A * v_mag**2
        F_l_x = 0
        F_l_y = F_l * np.cos(spin_axis_rad)
        F_l_z = F_l * np.sin(spin_axis_rad)
        
        # Total acceleration
        a_x = F_d_x / ball_mass_kg
        a_y = (F_d_y + F_l_y) / ball_mass_kg - g
        a_z = (F_d_z + F_l_z) / ball_mass_kg
        
        # Update velocity
        v_x += a_x * dt
        v_y += a_y * dt
        v_z += a_z * dt
        
        # Update position
        x += v_x * dt
        y += v_y * dt
        z += v_z * dt
        max_height_m = max(max_height_m, y)
        t += dt
    
    # Convert to yards and feet
    carry_yards = x * 1.09361
    side_ft = z * 3.28084
    max_height_ft = max_height_m * 3.28084
    
    return carry_yards, side_ft, max_height_ft

def objective_function(coefficients, df):
    """
    Compute MSE between physics model predictions and CSV data.
    
    Args:
        coefficients (list): [C_d, C_l_scale]
        df (pd.DataFrame): Input data with shot parameters and outcomes
    
    Returns:
        float: Mean squared error
    """
    C_d, C_l_scale = coefficients
    mse = 0
    n = len(df)
    
    for _, row in df.iterrows():
        carry_pred, side_pred, height_pred = adjust_trajectory(
            row['Ball (mph)'], row['Launch V (deg)'], row['Spin (rpm)'], row['Spin Axis (deg)'],
            row['Launch H (deg)'], row['Wind Speed (mph)'], row['Wind Direction (deg)'],
            row['Temperature (F)'], row['Humidity (%)'], 0,  # Altitude 0 ft (from Air Pressure)
            C_d, C_l_scale
        )
        mse += (carry_pred - row['Carry (yd)'])**2
        mse += (side_pred - row['Lateral (yd)'] * 3.28084)**2  # Convert CSV yards to feet
        mse += (height_pred - row['Height (ft)'])**2
    
    return mse / (3 * n)  # Average over three outputs and number of shots

def main():
    # File path
    data_path = "/Users/jacksonne/Python Projects/AI_Caddie/AI_Caddie/Shot_Data/random_flightscope_data.csv"
    
    # Load data
    if not os.path.exists(data_path):
        print(f"Error: {data_path} not found.")
        input("Press Enter to exit.")
        exit(1)
    
    df = pd.read_csv(data_path)
    print(f"Loaded {len(df)} rows from {data_path}")
    
    # Preprocess data (use numeric columns, convert to float)
    input_cols = ['Ball (mph)', 'Launch V (deg)', 'Launch H (deg)', 'Spin (rpm)', 'Spin Axis (deg)',
                  'Wind Speed (mph)', 'Wind Direction (deg)', 'Temperature (F)', 'Humidity (%)']
    output_cols = ['Carry (yd)', 'Lateral (yd)', 'Height (ft)']
    
    for col in input_cols + output_cols:
        df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0.0)
    
    # Initial coefficients
    initial_guess = [0.3, 0.00002]  # [C_d, C_l_scale]
    
    # Optimize coefficients
    result = minimize(
        objective_function,
        initial_guess,
        args=(df,),
        method='Nelder-Mead',
        bounds=[(0.1, 0.5), (1e-6, 1e-4)],  # Reasonable ranges for C_d and C_l_scale
        options={'maxiter': 1000}
    )
    
    if not result.success:
        print(f"Optimization failed: {result.message}")
        input("Press Enter to exit.")
        exit(1)
    
    C_d_opt, C_l_scale_opt = result.x
    print(f"\nOptimized Coefficients:")
    print(f"Drag Coefficient (C_d): {C_d_opt:.4f}")
    print(f"Lift Coefficient Scale (C_l = scale * spin_rpm): {C_l_scale_opt:.6f}")
    print(f"Final MSE: {result.fun:.2f}")
    
    # Evaluate model on sample data
    mse_carry, mse_side, mse_height = 0, 0, 0
    n = len(df)
    for _, row in df.iterrows():
        carry_pred, side_pred, height_pred = adjust_trajectory(
            row['Ball (mph)'], row['Launch V (deg)'], row['Spin (rpm)'], row['Spin Axis (deg)'],
            row['Launch H (deg)'], row['Wind Speed (mph)'], row['Wind Direction (deg)'],
            row['Temperature (F)'], row['Humidity (%)'], 0,
            C_d_opt, C_l_scale_opt
        )
        mse_carry += (carry_pred - row['Carry (yd)'])**2
        mse_side += (side_pred - row['Lateral (yd)'] * 3.28084)**2
        mse_height += (height_pred - row['Height (ft)'])**2
    
    mse_carry /= n
    mse_side /= n
    mse_height /= n
    
    print(f"\nModel Performance (RMSE):")
    print(f"Carry (yd): RMSE = {np.sqrt(mse_carry):.2f}")
    print(f"Lateral (ft): RMSE = {np.sqrt(mse_side):.2f}")
    print(f"Height (ft): RMSE = {np.sqrt(mse_height):.2f}")
    
    # Example prediction for first shot
    row = df.iloc[0]
    carry_pred, side_pred, height_pred = adjust_trajectory(
        row['Ball (mph)'], row['Launch V (deg)'], row['Spin (rpm)'], row['Spin Axis (deg)'],
        row['Launch H (deg)'], row['Wind Speed (mph)'], row['Wind Direction (deg)'],
        row['Temperature (F)'], row['Humidity (%)'], 0,
        C_d_opt, C_l_scale_opt
    )
    print(f"\nExample Prediction (Shot 1):")
    print(f"Input: Ball Speed = {row['Ball (mph)']:.1f} mph, Launch V = {row['Launch V (deg)']:.1f} deg, "
          f"Launch H = {row['Launch H (deg)']:.1f} deg, Spin = {row['Spin (rpm)']:.0f} rpm, "
          f"Spin Axis = {row['Spin Axis (deg)']:.1f} deg")
    print(f"Predicted: Carry = {carry_pred:.1f} yd, Lateral = {side_pred:.1f} ft, Height = {height_pred:.1f} ft")
    print(f"Actual: Carry = {row['Carry (yd)']:.1f} yd, Lateral = {row['Lateral (yd)'] * 3.28084:.1f} ft, "
          f"Height = {row['Height (ft)']:.1f} ft")

if __name__ == "__main__":
    main()