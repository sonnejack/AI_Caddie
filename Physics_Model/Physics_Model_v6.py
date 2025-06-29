import pandas as pd
import numpy as np
import plotly.graph_objects as go
from scipy.integrate import odeint
from scipy.optimize import minimize
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score
from itertools import groupby

class golf_ballstics:
    """
    Golf ball flight simulation model with optimized aerodynamic coefficients, including spin axis effects.
    Includes adaptive curvature scaling and zero curvature for zero spin axis shots with no wind.
    Based on MacDonald and Hanzely (1991), A.J. Smiths (1994), and Kothmann (2007).
    """
    
    def __init__(self):
        # Golf ball properties
        self.mass = None
        self.radius = None
        
        # Aerodynamic properties (optimized)
        self.C_d0 = 0.1796  # Base drag coefficient
        self.C_d1 = 0.3761  # Spin-dependent drag coefficient
        self.C_d2 = 0.0247  # Reynolds-dependent drag coefficient
        self.C_d4 = 0.0318  # Spin axis drag adjustment
        self.C_l2 = 0.0     # Reynolds-dependent lift adjustment
        self.C_l4 = 0.0259  # Spin axis lift adjustment
        
        # Air properties
        self.rho = None
        self.mu = 1.8e-5    # Dynamic viscosity of air (kg/m·s)
        self.Re_crit = 2e5  # Critical Reynolds number
        
        # Constants
        self.g = None
        
        # Initial flight properties
        self.velocity = []
        self.spin = None
        self.spin_angle = None
        self.windvelocity = []
        self.horizontal_launch_angle_deg = None  # Store for curvature scaling
        self.windspeed = None  # Store for wind check
        
        # ODE solver parameters
        self.endtime = 10   # Model ball flight for 10 sec
        self.timesteps = 100  # Initial time steps
        
        # Simulation results storage
        self.simres = None
        self.df_simres = pd.DataFrame(columns=['t', 'x', 'y', 'z', 'v_x', 'v_y', 'v_z', 'omega'])
        
        # Aerodynamic coefficient data
        self.sn_Cl = [[0, 0.04, 0.1, 0.2, 0.4], [0, 0.1, 0.16, 0.23, 0.33]]

    def initiate_hit(self, velocity, launch_angle_deg, horizontal_launch_angle_deg, 
                     spin_rpm, spin_angle_deg, windspeed, windheading_deg,  
                     mass=0.0455, radius=0.0213, rho=1.225, g=9.81):
        """
        Simulates golf ball flight and stores results in self.df_simres.
        """
        self.mass = mass
        self.radius = radius
        self.rho = rho
        self.g = g
        self.horizontal_launch_angle_deg = horizontal_launch_angle_deg
        self.windspeed = windspeed
        self.spin = spin_rpm / 60  # Convert to rev/s
        self.spin_angle = spin_angle_deg / 180 * np.pi
        
        # Ball velocity vector
        theta = launch_angle_deg / 180 * np.pi
        psi = horizontal_launch_angle_deg / 180 * np.pi
        self.velocity = velocity * np.array([
            np.cos(theta) * np.sin(psi),  # x
            np.cos(theta) * np.cos(psi),  # y
            np.sin(theta)               # z
        ])
        
        # Wind velocity vector
        windheading = windheading_deg / 180 * np.pi
        self.windvelocity = windspeed * np.array([
            np.sin(windheading),  # x
            np.cos(windheading),  # y
            0                     # z
        ])
        
        self.simulate()
    
    def get_landingpos(self, check=False, curvature_scale_params=(-0.0578,0.8388,0.500), *args, **kwargs):
        """
        Returns landing coordinates (x, y) in meters when the ball hits the ground.
        Applies adaptive curvature scaling: scale = a * |curvature_yd|^p + b
        Forces zero curvature for spin_axis=0 and windspeed=0.
        
        Parameters:
        - check (bool): If True, performs sanity checks and returns an error message
        - curvature_scale_params (tuple): Parameters (a, b, p) for scaling function
        Parameters last optimized on 6/29/2025 3:06 pm, R^2 = 0.9463
        - *args, **kwargs: Passed to initiate_hit
        """
        a, b, p = curvature_scale_params
        imax = 3
        err = ''
        cont = True
        default_endtime = self.endtime
        i = 0
        
        while cont:
            self.initiate_hit(*args, **kwargs)
            i += 1
            err = ''
            cont = False
            
            if self.df_simres['z'].iloc[-1] > 0:
                err = 'error: ball never lands'
                self.endtime *= 2
                cont = True
            elif check:
                if len(list(groupby(self.df_simres['z'], lambda x: x >= 0))) - 1 > 1:
                    err = 'error: ball passes through the ground multiple times'
            
            if i >= imax:
                cont = False
        
        self.endtime = default_endtime
        
        if err == '':
            index = np.argmax(self.df_simres['z'] < 0) - 1
            p1 = (self.df_simres['x'][index], self.df_simres['y'][index], self.df_simres['z'][index])
            p2 = (self.df_simres['x'][index + 1], self.df_simres['y'][index + 1], self.df_simres['z'][index + 1])
            t = p1[2] / (p1[2] - p2[2])
            x = p1[0] + t * (p2[0] - p1[0])
            y = p1[1] + t * (p2[1] - p1[1])
            
            # Convert to yards for curvature calculation
            y_yd = y * 1.09361
            x_yd = x * 1.09361
            psi = self.horizontal_launch_angle_deg * np.pi / 180
            x_straight_yd = y_yd * np.tan(psi)
            curvature_yd = x_yd - x_straight_yd
            
            # Check for zero spin axis and no wind
            if abs(self.spin_angle) < 1e-6 and abs(self.windspeed) < 1e-6:
                x_adjusted_yd = x_straight_yd  # Zero curvature
            else:
                # Apply adaptive scaling: scale = a * |curvature_yd|^p + b
                scale = a * (abs(curvature_yd) ** p) + b
                scale = max(0.1, min(scale, 2.0))  # Bound scale
                scaled_curvature_yd = curvature_yd * scale
                x_adjusted_yd = x_straight_yd + scaled_curvature_yd
            
            # Convert back to meters
            x_adjusted = x_adjusted_yd / 1.09361
        else:
            x_adjusted, y = 0, 0
        
        if check:
            return x_adjusted, y, err
        return x_adjusted, y
    
    
    def B(self):
        area = np.pi * self.radius**2
        return self.rho * area / (2 * self.mass)
    
    def effective_spin(self, v, omega):
        sn = omega * 2 * np.pi * self.radius / v
        return sn
    
    def reynolds_number(self, v):
        D = 2 * self.radius
        return self.rho * v * D / self.mu
    
    def Cd(self, v, omega):
        sn = self.effective_spin(v, omega)
        Re = self.reynolds_number(v)
        cd = self.C_d0 + self.C_d1 * sn + self.C_d2 / (1 + Re / self.Re_crit) + self.C_d4 * abs(np.sin(self.spin_angle))
        return cd
    
    def Cl(self, v, omega):
        sn = self.effective_spin(v, omega)
        cl = np.interp(x=sn, xp=self.sn_Cl[0], fp=self.sn_Cl[1])
        Re = self.reynolds_number(v)
        cl_adjusted = cl * (1 + self.C_l2 * (Re / self.Re_crit)) * (1 + self.C_l4 * np.sin(self.spin_angle)**2)
        return cl_adjusted
    
    def model(self, state, t):
        x, y, z, vx, vy, vz, omega = state
        v_ball = np.array([vx, vy, vz])
        v_rel = v_ball - self.windvelocity
        u = np.linalg.norm(v_rel)
        
        a = self.spin_angle
        B = self.B()
        Cl = self.Cl(u, omega)
        Cd = self.Cd(u, omega)
        
        ux, uy, uz = v_rel
        dvxdt = -B * u * (Cd * ux - Cl * uy * np.sin(a))
        dvydt = -B * u * (Cd * uy - Cl * (ux * np.sin(a) - uz * np.cos(a)))
        dvzdt = -self.g - B * u * (Cd * uz - Cl * uy * np.cos(a))
        domega_dt = 0  # No spin decay
        
        return [vx, vy, vz, dvxdt, dvydt, dvzdt, domega_dt]
    
    def simulate(self):
        self.df_simres['t'] = np.linspace(0, self.endtime, self.timesteps)
        v0 = [0, 0, 0, self.velocity[0], self.velocity[1], self.velocity[2], self.spin]
        self.simres = odeint(self.model, v0, self.df_simres['t'])
        self.df_simres['x'] = self.simres[:, 0]
        self.df_simres['y'] = self.simres[:, 1]
        self.df_simres['z'] = self.simres[:, 2]
        self.df_simres['v_x'] = self.simres[:, 3]
        self.df_simres['v_y'] = self.simres[:, 4]
        self.df_simres['v_z'] = self.simres[:, 5]
        self.df_simres['omega'] = self.simres[:, 6]

def calculate_air_density(T_f, RH, P_psi):
    """
    Calculate air density (kg/m^3) from temperature (F), relative humidity (%), and pressure (psi).
    """
    T_c = (T_f - 32) * 5 / 9
    T_k = T_c + 273.15
    P_sat = 611.21 * np.exp((18.678 - (T_c / 234.5)) * (T_c / (257.14 + T_c)))
    P_v = (RH / 100) * P_sat
    P_pa = P_psi * 6894.76
    R_d = 287.05
    rho = (P_pa / (R_d * T_k)) * (1 - 0.378 * (P_v / P_pa))
    return rho

# Load Excel data
file_path = '/Users/jacksonne/Python Projects/AI_Caddie/AI_Caddie/Data_Collection/random_flightscope_data.xlsx'
df = pd.read_excel(file_path)

# Convert columns to numeric
numeric_columns = [
    'Ball Speed (mph)', 'Spin Rate (rpm)', 'Spin Axis (deg)', 'Launch V (deg)', 
    'Launch H (deg)', 'Wind Speed (mph)', 'Temperature (F)', 'Humidity (%)', 
    'Air Pressure (psi)', 'Carry (yd)', 'Lateral (yd)', 'Height (ft)', 'Wind Direction (deg)'
]
for col in numeric_columns:
    df[col] = pd.to_numeric(df[col], errors='coerce')

# Drop rows with NaN in required columns
required_columns = [
    'Ball Speed (mph)', 'Spin Rate (rpm)', 'Spin Axis (deg)', 'Launch V (deg)', 
    'Launch H (deg)', 'Wind Speed (mph)', 'Temperature (F)', 'Humidity (%)', 
    'Air Pressure (psi)', 'Carry (yd)', 'Lateral (yd)', 'Height (ft)', 'Wind Direction (deg)'
]
df = df.dropna(subset=required_columns)

# Function to classify a shot
def classify_shot(launch_h_deg, spin_axis_deg):
    """
    Classify shot based on horizontal launch angle and spin axis.
    """
    if launch_h_deg < 0:
        if spin_axis_deg < 0:
            return "Pull Draw"
        elif spin_axis_deg == 0:
            return "Pull"
        else:
            return "Pull Fade"
    elif launch_h_deg == 0:
        if spin_axis_deg < 0:
            return "Draw"
        elif spin_axis_deg == 0:
            return "Straight"
        else:
            return "Fade"
    elif launch_h_deg > 0:
        if spin_axis_deg < 0:
            return "Push Draw"
        elif spin_axis_deg == 0:
            return "Push"
        elif spin_axis_deg > 0:
            return "Push Fade"
    else:
        return "Unknown"

# Initialize golf model
golf_m = golf_ballstics()

# Process shots with optimized scaling parameters
df['sim_carry_yd'] = np.nan
df['sim_lateral_yd'] = np.nan
df['sim_apex_height_ft'] = np.nan
df['actual_curvature_ft'] = np.nan
df['sim_curvature_ft'] = np.nan

for index, row in df.iterrows():
    ball_speed_mph = row['Ball Speed (mph)']
    spin_rpm = row['Spin Rate (rpm)']
    spin_axis_deg = row['Spin Axis (deg)']
    launch_v_deg = row['Launch V (deg)']
    launch_h_deg = row['Launch H (deg)']
    wind_speed_mph = row['Wind Speed (mph)']
    wind_direction_deg = row['Wind Direction (deg)']
    T_f = row['Temperature (F)']
    RH = row['Humidity (%)']
    P_psi = row['Air Pressure (psi)']
    
    velocity_mps = ball_speed_mph * 0.44704
    windspeed_mps = wind_speed_mph * 0.44704
    rho = calculate_air_density(T_f, RH, P_psi)

    x_m, y_m = golf_m.get_landingpos(
        velocity=velocity_mps,
        launch_angle_deg=launch_v_deg,
        horizontal_launch_angle_deg=launch_h_deg,
        spin_rpm=spin_rpm,
        spin_angle_deg=spin_axis_deg,
        windspeed=windspeed_mps,
        windheading_deg=wind_direction_deg,
        rho=rho
    )
    
    sim_lateral_yd = x_m * 1.09361
    sim_carry_yd = y_m * 1.09361
    apex_height_m = max(golf_m.df_simres['z'][golf_m.df_simres['z'] >= 0])
    sim_apex_height_ft = apex_height_m * 1.09361 * 3
        
    # Calculate curvatures
    x_straight_actual_yd = row['Carry (yd)'] * np.tan(launch_h_deg * np.pi / 180)
    x_straight_sim_yd = sim_carry_yd * np.tan(launch_h_deg * np.pi / 180)
    actual_curvature_ft = (row['Lateral (yd)'] - x_straight_actual_yd) * 3
    sim_curvature_ft = (sim_lateral_yd - x_straight_sim_yd) * 3
    
    df.at[index, 'sim_lateral_yd'] = sim_lateral_yd
    df.at[index, 'sim_carry_yd'] = sim_carry_yd
    df.at[index, 'sim_apex_height_ft'] = sim_apex_height_ft
    df.at[index, 'actual_curvature_ft'] = actual_curvature_ft
    df.at[index, 'sim_curvature_ft'] = sim_curvature_ft

# Calculate differences
df['carry_diff'] = df['sim_carry_yd'] - df['Carry (yd)']
df['side_diff'] = df['sim_lateral_yd'] - df['Lateral (yd)']
df['apex_diff'] = df['sim_apex_height_ft'] - df['Height (ft)']

# Calculate percent errors
df['carry_percent_error'] = np.where(
    df['Carry (yd)'] != 0,
    (abs(df['carry_diff']) / df['Carry (yd)']) * 100,
    np.nan
)
df['side_percent_error'] = np.where(
    df['Lateral (yd)'] != 0,
    (abs(df['side_diff']) / df['Lateral (yd)']) * 100,
    np.nan
)

# Add Shot Classification
df['Shot Classification'] = df.apply(lambda row: classify_shot(row['Launch H (deg)'], row['Spin Axis (deg)']), axis=1)

# Define the output file path
output_path = '/Users/jacksonne/Python Projects/AI_Caddie/AI_Caddie/Data_Collection/random_flightscope_data_classified.xlsx'
df.to_excel(output_path, index=False)
print(f"\nUpdated DataFrame with shot classifications and curvature saved to {output_path}")

# Create comparison DataFrame
comparison_df = pd.DataFrame({
    'Simulated Carry (yd)': df['sim_carry_yd'],
    'Actual Carry (yd)': df['Carry (yd)'],
    'Carry Difference (yd)': df['carry_diff'],
    'Carry Percent Error (%)': df['carry_percent_error'],
    'Simulated Side (yd)': df['sim_lateral_yd'],
    'Actual Side (yd)': df['Lateral (yd)'],
    'Side Difference (yd)': df['side_diff'],
    'Side Percent Error (%)': df['side_percent_error'],
    'Simulated Height (ft)': df['sim_apex_height_ft'],
    'Actual Height (ft)': df['Height (ft)'],
    'Apex Difference (ft)': df['apex_diff'],
    'Simulated Curvature (ft)': df['sim_curvature_ft'],
    'Actual Curvature (ft)': df['actual_curvature_ft']
})
comparison_df.index.name = 'Shot'
print("\nComparison Table:")
print(comparison_df)

# --- Plotly Visualization ---
shot_types = df['Shot Classification'].unique()
traces = []
buttons = []

for i, shot_type in enumerate(shot_types):
    type_df = df[df['Shot Classification'] == shot_type]
    
    sim_trace = go.Scatter(
        x=type_df['sim_lateral_yd'],
        y=type_df['sim_carry_yd'],
        mode='markers',
        name=f'{shot_type} Simulated',
        marker=dict(color='blue', symbol='circle'),
        hovertext=[f"Simulated<br>Ball Speed: {row['Ball Speed (mph)']} mph<br>Launch V: {row['Launch V (deg)']} deg<br>Apex: {row['sim_apex_height_ft']:.1f} ft<br>Curvature: {row['sim_curvature_ft']:.1f} ft" 
                   for _, row in type_df.iterrows()],
        hoverinfo='text'
    )
    
    act_trace = go.Scatter(
        x=type_df['Lateral (yd)'],
        y=type_df['Carry (yd)'],
        mode='markers',
        name=f'{shot_type} Actual',
        marker=dict(color='red', symbol='x'),
        hovertext=[f"Actual<br>Ball Speed: {row['Ball Speed (mph)']} mph<br>Launch V: {row['Launch V (deg)']} deg<br>Apex: {row['Height (ft)']:.1f} ft<br>Curvature: {row['actual_curvature_ft']:.1f} ft" 
                   for _, row in type_df.iterrows()],
        hoverinfo='text'
    )
    
    x_lines = []
    y_lines = []
    for _, row in type_df.iterrows():
        x_lines.extend([row['sim_lateral_yd'], row['Lateral (yd)'], None])
        y_lines.extend([row['sim_carry_yd'], row['Carry (yd)'], None])
    line_trace = go.Scatter(
        x=x_lines,
        y=y_lines,
        mode='lines',
        name=f'{shot_type} Error Lines',
        line=dict(color='gray', width=1),
        hoverinfo='skip'
    )
    
    traces.extend([sim_trace, act_trace, line_trace])
    
    visibility = [False] * (len(shot_types) * 3)
    visibility[i*3 : i*3+3] = [True, True, True]
    button = dict(
        label=shot_type,
        method='update',
        args=[{'visible': visibility}]
    )
    buttons.append(button)

fig = go.Figure(data=traces)
fig.update_layout(
    updatemenus=[dict(buttons=buttons, direction='down', showactive=True)],
    xaxis_title='Side Distance (yards)',
    yaxis_title='Carry Distance (yards)',
    title=f'Golf Shot Landing Positions by Shot Type)'
)
all_lateral = pd.concat([df['sim_lateral_yd'], df['Lateral (yd)']])
all_carry = pd.concat([df['sim_carry_yd'], df['Carry (yd)']])
x_min = all_lateral.min() - 0.1 * (all_lateral.max() - all_lateral.min())
x_max = all_lateral.max() + 0.1 * (all_lateral.max() - all_lateral.min())
y_max = all_carry.max() * 1.1
fig.update_layout(xaxis_range=[x_min, x_max], yaxis_range=[0, y_max])
fig.show()