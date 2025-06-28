import numpy as np

def adjust_trajectory(ball_speed_mph, launch_angle_deg, spin_rate_rpm, spin_axis_deg, launch_direction_deg,
                     wind_speed_mph, wind_direction_deg, temperature_f, humidity_percent, altitude_ft):
    """
    Calculate adjusted carry distance and side for a golf shot given launch and environmental conditions.
    
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
    
    Returns:
        tuple: (adjusted_carry_yards, adjusted_side_ft)
    """
    # Constants
    g = 9.81  # Gravity (m/s^2)
    ball_mass_kg = 0.04593  # Golf ball mass (kg)
    ball_radius_m = 0.021335  # Golf ball radius (m)
    A = np.pi * ball_radius_m**2  # Cross-sectional area (m^2)
    C_d = 0.261  # Drag coefficient (increased for more drag)
    
    # Convert inputs to SI units
    ball_speed_ms = ball_speed_mph * 0.44704  # mph to m/s
    launch_angle_rad = np.radians(launch_angle_deg)
    launch_direction_rad = np.radians(launch_direction_deg)
    spin_rate_radps = spin_rate_rpm * 2 * np.pi / 60  # rpm to rad/s
    spin_axis_rad = np.radians(spin_axis_deg)
    
    # Lift coefficient (scaled with spin rate)
    C_l = 0.000022 * spin_rate_rpm  # Adjust lift based on spin (e.g., 0.05–0.24 for 2500–12000 rpm)
    
    # Calculate air density (kg/m^3)
    temp_c = (temperature_f - 32) * 5/9
    pressure_mb = 1013.25 * np.exp(-0.00012 * altitude_ft * 0.3048)  # ft to m
    rho = 1.225 * (pressure_mb / 1013.25) * (288.15 / (temp_c + 273.15)) * (1 - 0.01 * humidity_percent / 100)
    
    # Initial velocity components
    v_x = ball_speed_ms * np.cos(launch_angle_rad)  # Forward
    v_y = ball_speed_ms * np.sin(launch_angle_rad)  # Vertical
    v_z = ball_speed_ms * np.sin(launch_direction_rad) * np.cos(launch_angle_rad)  # Lateral (from launch direction)
    
    # Time step for numerical integration
    dt = 0.005  # seconds (smaller for accuracy)
    t = 0
    x, y, z = 0, 0, 0  # Initial position (m)
    
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
        t += dt
    
    # Convert to yards and feet
    adjusted_carry_yards = x * 1.09361
    adjusted_side_ft = z * 3.28084
    
    return adjusted_carry_yards, adjusted_side_ft

def validate_float(value, name, min_val=None, max_val=None):
    """Validate that input is a float and within optional range."""
    try:
        val = float(value)
        if min_val is not None and val < min_val:
            raise ValueError(f"{name} must be >= {min_val}")
        if max_val is not None and val > max_val:
            raise ValueError(f"{name} must be <= {max_val}")
        return val
    except ValueError as e:
        if str(e).startswith(name):
            raise
        raise ValueError(f"Invalid input for {name}: must be aiamm")

# Collect user inputs
try:
    print("Enter launch conditions:")
    ball_speed_mph = validate_float(input("Ball Speed (mph): "), "Ball Speed", 50, 200)
    launch_angle_deg = validate_float(input("Launch Angle (degrees): "), "Launch Angle", 0, 45)
    spin_rate_rpm = validate_float(input("Spin Rate (rpm): "), "Spin Rate", 0, 12000)
    spin_axis_deg = validate_float(input("Spin Axis (degrees, positive=fade, negative=draw): "), "Spin Axis", -30, 30)
    launch_direction_deg = validate_float(input("Launch Direction (degrees, positive=right, negative=left): "), 
                                         "Launch Direction", -30, 30)
    
    print("\nEnter environmental conditions:")
    wind_speed_mph = validate_float(input("Wind Speed (mph): "), "Wind Speed", 0, 50)
    wind_direction_deg = validate_float(input("Wind Direction (degrees, 0=tailwind, 180=headwind, 90=left-to-right): "), 
                                       "Wind Direction", 0, 360)
    temperature_f = validate_float(input("Temperature (F): "), "Temperature", -20, 120)
    humidity_percent = validate_float(input("Humidity (%): "), "Humidity", 0, 100)
    altitude_ft = validate_float(input("Altitude (ft): "), "Altitude", 0, 15000)
except ValueError as e:
    print(f"Error: {e}")
    exit(1)

# Calculate trajectory
try:
    carry_yards, side_ft = adjust_trajectory(
        ball_speed_mph, launch_angle_deg, spin_rate_rpm, spin_axis_deg, launch_direction_deg,
        wind_speed_mph, wind_direction_deg, temperature_f, humidity_percent, altitude_ft
    )
    print(f"\nCalculated Results:")
    print(f"Carry Distance: {carry_yards:.2f} yards")
    print(f"Carry Side: {side_ft:.2f} ft (positive = right, negative = left)")
except Exception as e:
    print(f"Error calculating trajectory: {e}")
    exit(1)

# Prompt for FlightScope results
try:
    print("\nEnter FlightScope Trajectory Optimizer results for comparison:")
    flightscope_carry = validate_float(input("FlightScope Carry Distance (yards): "), "FlightScope Carry Distance", 0)
    flightscope_side = validate_float(input("FlightScope Carry Side (ft): "), "FlightScope Carry Side")
    
    # Compare results
    carry_diff = carry_yards - flightscope_carry
    side_diff = side_ft - flightscope_side
    print(f"\nComparison with FlightScope:")
    print(f"Carry Distance Difference: {carry_diff:.2f} yards")
    print(f"Carry Side Difference: {side_diff:.2f} ft")
except ValueError as e:
    print(f"Error: {e}")
except Exception as e:
    print(f"Error processing FlightScope comparison: {e}")