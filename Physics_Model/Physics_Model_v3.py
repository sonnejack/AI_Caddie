import pandas as pd
import numpy as np
import plotly.graph_objects as go
from scipy.integrate import odeint
from itertools import groupby

class golf_ballstics:
    """
    Golf ball flight simulation model based on MacDonald and Hanzely (1991) and aerodynamic coefficients
    from A.J. Smiths (1994) and Kothmann (2007), with adjustments for Cd scaling, Cl scaling, and spin decay.
    """
    
    def __init__(self):
        # Golf ball properties
        self.mass = None
        self.radius = None
        
        # Aerodynamic properties
        self.sn_Cl = [[0, 0.04, 0.1, 0.2, 0.4], [0, 0.1, 0.16, 0.23, 0.33]]
        self.cd_scale = 1.0094  # Scale drag coefficient by 1.15%
        self.cl_scale = 1.0002  # Scale lift coefficient by 0.46%
        self.k_decay = 0.00   # Spin decay constant (s^-1) -- higher value means faster decay, and empirically means a shorter distance travelled
        
        # Air properties
        self.rho = None
        
        # Constants
        self.g = None
        
        # Initial flight properties
        self.velocity = []
        self.spin = None
        self.spin_angle = None
        self.windvelocity = []
        
        # ODE solver parameters
        self.endtime = 10  # Model ball flight for 10 sec
        self.timesteps = 100  # Initial time steps
        
        # Simulation results storage
        self.simres = None
        self.df_simres = pd.DataFrame(columns=['t', 'x', 'y', 'z', 'v_x', 'v_y', 'v_z', 'omega'])

    def initiate_hit(self, velocity, launch_angle_deg, horizontal_launch_angle_deg, 
                     spin_rpm, spin_angle_deg, windspeed, windheading_deg,  
                     mass=0.0455, radius=0.0213, rho=1.225, g=9.81):
        """
        Simulates golf ball flight and stores results in self.df_simres.
        
        Parameters:
        - velocity (m/s): Initial ball speed
        - launch_angle_deg (deg): Vertical launch angle
        - horizontal_launch_angle_deg (deg): Horizontal launch angle
        - spin_rpm (rpm): Ball spin rate
        - spin_angle_deg (deg): Spin axis angle
        - windspeed (m/s): Wind speed
        - windheading_deg (deg): Wind direction (0 deg = tail wind)
        - mass (kg), radius (m), rho (kg/m^3), g (m/s^2): Optional physical parameters
        """
        self.mass = mass
        self.radius = radius
        self.rho = rho
        self.g = g
        
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
        windheading = windheading_deg / 180 * np.pi  # 0 deg is tail wind
        self.windvelocity = windspeed * np.array([
            np.sin(windheading),  # x
            np.cos(windheading),  # y
            0                     # z
        ])
        
        self.simulate()
    
    def get_landingpos(self, check=False, *args, **kwargs):
        """
        Returns landing coordinates (x, y) in meters when the ball hits the ground.
        
        Parameters:
        - check (bool): If True, performs sanity checks and returns an error message
        - *args, **kwargs: Passed to initiate_hit
        
        Returns:
        - x (m): Side distance
        - y (m):发动 Carry distance
        - err (str, optional): Error message if check=True
        """
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
        else:
            x, y = 0, 0
        
        if check:
            return x, y, err
        return x, y
    
    def B(self):
        area = np.pi * self.radius**2
        return self.rho * area / (2 * self.mass)
    
    def effective_spin(self, v, omega):
        sn = omega * 2 * np.pi * self.radius / v
        return sn
    
    def Cd(self, v, omega):
        """Drag coefficient adjusted with scaling factor."""
        sn = self.effective_spin(v, omega)
        cd = 0.24 + 0.18 * sn
        return cd * self.cd_scale
    
    def Cl(self, v, omega):
        """Lift coefficient adjusted with scaling factor."""
        sn = self.effective_spin(v, omega)
        cl = np.interp(x=sn, xp=self.sn_Cl[0], fp=self.sn_Cl[1])
        return cl * self.cl_scale
    
    def model(self, state, t):
        """ODE model including spin decay."""
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
        domega_dt = -self.k_decay * omega
        
        return [vx, vy, vz, dvxdt, dvydt, dvzdt, domega_dt]
    
    def simulate(self):
        """Simulate ball flight with spin as a state variable."""
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
    Uses the Arden Buck equation for saturation vapor pressure and an approximation for moist air.
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
    'Air Pressure (psi)', 'Carry (yd)', 'Lateral (yd)', 'Height (ft)'
]
for col in numeric_columns:
    df[col] = pd.to_numeric(df[col], errors='coerce')

# Drop rows with NaN in required columns
required_columns = [
    'Ball Speed (mph)', 'Spin Rate (rpm)', 'Spin Axis (deg)', 'Launch V (deg)', 
    'Launch H (deg)', 'Wind Speed (mph)', 'Temperature (F)', 'Humidity (%)', 
    'Air Pressure (psi)'
]
df = df.dropna(subset=required_columns)

# Function to classify a shot based on Launch H (deg) and Spin Axis (deg)
def classify_shot(launch_h, spin_axis):
    if launch_h < 0:
        if spin_axis < 0:
            return "Pull Draw"
        elif spin_axis == 0:
            return "Pull"
        else:
            return "Pull Fade"
    elif launch_h == 0:
        if spin_axis < 0:
            return "Draw"
        elif spin_axis == 0:
            return "Straight"
        else:
            return "Fade"
    else:
        if spin_axis < 0:
            return "Push Draw"
        elif spin_axis == 0:
            return "Push"
        else:
            return "Push Fade"

# Define the output file path in the same location
output_path = '/Users/jacksonne/Python Projects/AI_Caddie/AI_Caddie/Data_Collection/random_flightscope_data_classified.xlsx'

# Initialize golf model
golf_m = golf_ballstics()

# Add columns for simulated results
df['sim_carry_yd'] = np.nan
df['sim_lateral_yd'] = np.nan
df['sim_apex_height_ft'] = np.nan

# Process each shot
for index, row in df.iterrows():
    # Extract inputs in imperial units
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
    
    # Convert to SI units for simulation
    velocity_mps = ball_speed_mph * 0.44704
    windspeed_mps = wind_speed_mph * 0.44704
    rho = calculate_air_density(T_f, RH, P_psi)
    
    # Simulate landing position
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
    
    # Convert meters to yards
    sim_lateral_yd = x_m * 1.09361
    sim_carry_yd = y_m * 1.09361
    apex_height_m = max(golf_m.df_simres['z'][golf_m.df_simres['z'] >= 0])
    sim_apex_height_ft = apex_height_m * 1.09361 * 3
    
    # Store results
    df.at[index, 'sim_lateral_yd'] = sim_lateral_yd
    df.at[index, 'sim_carry_yd'] = sim_carry_yd
    df.at[index, 'sim_apex_height_ft'] = sim_apex_height_ft

# Calculate differences between simulated and actual values
df['carry_diff'] = df['sim_carry_yd'] - df['Carry (yd)']
df['side_diff'] = df['sim_lateral_yd'] - df['Lateral (yd)']
df['apex_diff'] = df['sim_apex_height_ft'] - df['Height (ft)']  

# Calculate percent errors, handling cases where actual value is zero
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

# Add Shot Classification column
df['Shot Classification'] = df.apply(lambda row: classify_shot(row['Launch H (deg)'], row['Spin Axis (deg)']), axis=1)

# Save the updated DataFrame to a new Excel file
df.to_excel(output_path, index=False)

print(f"Updated DataFrame with shot classifications saved to {output_path}")

# Create a comparison DataFrame with clear column names
comparison_df = pd.DataFrame({
    'Simulated Carry (yd)': df['sim_carry_yd'],
    'Actual Carry (yd)': df['Carry (yd)'],
    'Carry Difference (yd)': df['carry_diff'],
    'Carry Percent Error (%)': df['carry_percent_error'],
    'Simulated Side (yd)': df['sim_lateral_yd'],
    'Actual Side (yd)': df['Lateral (yd)'],
    'Side Difference (yd)': df['side_diff'],
    'Side Percent Error (%)': df['side_percent_error'],
    'Simulated Height (ft)': df['sim_apex_height_ft'] * 3,
    'Actual Height (ft)': df['Height (ft)'],
    'Apex Difference (ft)': df['apex_diff']
})

# Name the index as 'Shot' for clarity
comparison_df.index.name = 'Shot'

# Display the comparison table
print(comparison_df)

# --- Plotly Visualization ---

# Get unique shot types
shot_types = df['Shot Classification'].unique()

# Prepare traces for each shot type
traces = []
buttons = []

for i, shot_type in enumerate(shot_types):
    type_df = df[df['Shot Classification'] == shot_type]
    
    # Simulated points trace
    sim_trace = go.Scatter(
        x=type_df['sim_lateral_yd'],
        y=type_df['sim_carry_yd'],
        mode='markers',
        name=f'{shot_type} Simulated',
        marker=dict(color='blue', symbol='circle'),
        hovertext=[f"Simulated<br>Ball Speed: {row['Ball Speed (mph)']} mph<br>Launch V: {row['Launch V (deg)']} deg<br>Apex: {row['sim_apex_height_ft']:.1f} ft" 
                   for _, row in type_df.iterrows()],
        hoverinfo='text'
    )
    
    # Actual points trace
    act_trace = go.Scatter(
        x=type_df['Lateral (yd)'],
        y=type_df['Carry (yd)'],
        mode='markers',
        name=f'{shot_type} Actual',
        marker=dict(color='red', symbol='x'),
        hovertext=[f"Actual<br>Ball Speed: {row['Ball Speed (mph)']} mph<br>Launch V: {row['Launch V (deg)']} deg<br>Apex: {row['Height (ft)']:.1f} ft" 
                   for _, row in type_df.iterrows()],
        hoverinfo='text'
    )
    
    # Line trace for error lines
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
    
    # Add traces to the list
    traces.extend([sim_trace, act_trace, line_trace])
    
    # Create visibility list: True for this shot type's traces, False for others
    visibility = [False] * (len(shot_types) * 3)
    visibility[i*3 : i*3+3] = [True, True, True]
    
    # Create button dictionary
    button = dict(
        label=shot_type,
        method='update',
        args=[{'visible': visibility}]
    )
    buttons.append(button)

# Create the figure
fig = go.Figure(data=traces)

# Add dropdown menu
fig.update_layout(
    updatemenus=[
        dict(
            buttons=buttons,
            direction='down',
            showactive=True,
        )
    ],
    xaxis_title='Side Distance (yards)',
    yaxis_title='Carry Distance (yards)',
    title='Golf Shot Landing Positions by Shot Type'
)

# Calculate axis ranges
all_lateral = pd.concat([df['sim_lateral_yd'], df['Lateral (yd)']])
all_carry = pd.concat([df['sim_carry_yd'], df['Carry (yd)']])
x_min = all_lateral.min() - 0.1 * (all_lateral.max() - all_lateral.min())
x_max = all_lateral.max() + 0.1 * (all_lateral.max() - all_lateral.min())
y_max = all_carry.max() * 1.1

# Set axis ranges
fig.update_layout(
    xaxis_range=[x_min, x_max],
    yaxis_range=[0, y_max]
)

# Show the figure
fig.show()