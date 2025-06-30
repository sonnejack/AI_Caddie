import dash
from dash import dcc, html, Input, Output, State
import plotly.graph_objects as go
import pandas as pd
import numpy as np
from scipy.integrate import odeint
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
        
        # Aerodynamic properties (optimized 6/29/2025 6:25 pm)
        self.C_d0 = 0.1501  # Base drag coefficient
        self.C_d1 = 0.3010  # Spin-dependent drag coefficient
        self.C_d2 = 0.0800  # Reynolds-dependent drag coefficient
        self.C_d4 = 0.0219  # Spin axis drag adjustment
        self.C_l2 = 0.0     # Reynolds-dependent lift adjustment
        self.C_l4 = 0.0330  # Spin axis lift adjustment
        
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
    
    def get_landingpos(self, check=False, curvature_scale_params=(-0.0666,0.8673,0.5023), *args, **kwargs):
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


# Initialize Dash app
app = dash.Dash(__name__)

# Default input parameters
default_input = {
    'velocity': 67.056,  # Ball speed in m/s (150 mph)
    'launch_angle_deg': 15.0,
    'horizontal_launch_angle_deg': 0.0,
    'spin_rpm': 3000,
    'spin_angle_deg': 0.0,
    'windspeed': 0.0,
    'windheading_deg': 0.0,
    'mass': 0.0455,
    'radius': 0.0213,
    'rho': 1.225,
    'g': 9.81
}

# Input groups for vertical stacking
input_groups = [
    html.Div([
        html.Label("Ball Speed (mph):"),
        dcc.Input(id='ball-speed', value=150.0, type='number', step=0.1)
    ], style={'margin-bottom': '10px'}),
    html.Div([
        html.Label("Launch Angle (deg):"),
        dcc.Input(id='launch-angle', value=15.0, type='number', step=0.1)
    ], style={'margin-bottom': '10px'}),
    html.Div([
        html.Label("Horizontal Launch Angle (deg):"),
        dcc.Input(id='horizontal-launch-angle', value=0.0, type='number', step=0.1)
    ], style={'margin-bottom': '10px'}),
    html.Div([
        html.Label("Spin Rate (rpm):"),
        dcc.Input(id='spin-rate', value=3000, type='number', step=10)
    ], style={'margin-bottom': '10px'}),
    html.Div([
        html.Label("Spin Axis (deg):"),
        dcc.Input(id='spin-axis', value=0.0, type='number', step=0.1)
    ], style={'margin-bottom': '10px'}),
    html.Div([
        html.Label("Wind Speed (mph):"),
        dcc.Input(id='wind-speed', value=0.0, type='number', step=0.1)
    ], style={'margin-bottom': '10px'}),
    html.Div([
        html.Label("Wind Direction (deg):"),
        dcc.Input(id='wind-direction', value=0.0, type='number', step=0.1)
    ], style={'margin-bottom': '10px'}),
    html.Div([
        html.Label("Temperature (F):"),
        dcc.Input(id='temperature', value=70.0, type='number', step=0.1)
    ], style={'margin-bottom': '10px'}),
    html.Div([
        html.Label("Humidity (%):"),
        dcc.Input(id='humidity', value=50.0, type='number', step=0.1)
    ], style={'margin-bottom': '10px'}),
    html.Div([
        html.Label("Air Pressure (psi):"),
        dcc.Input(id='air-pressure', value=14.7, type='number', step=0.01)
    ], style={'margin-bottom': '10px'}),
]

app.layout = html.Div([
    html.H1("Golf Ball Trajectory Simulator", style={'textAlign': 'center'}),

    # Flex container: left panel (inputs + metrics), right panel (plot)
    html.Div([
        # Left column: inputs and landing output
        html.Div([
            html.H3("Shot Parameters"),
            *input_groups,
            html.Button('Go', id='go-button', n_clicks=0),
            html.H3("Landing Metrics", style={'marginTop': '30px'}),
            html.Div(id='landing-output')
        ], style={
            'width': '30%',
            'padding': '20px',
            'boxSizing': 'border-box',
            'display': 'inline-block',
            'verticalAlign': 'top'
        }),

        # Right column: plot fills remaining space
        html.Div([
            dcc.Graph(id='trajectory-plot', style={'height': '80vh', 'width': '100%'})
        ], style={
            'width': '70%',
            'padding': '20px',
            'boxSizing': 'border-box',
            'display': 'inline-block',
            'verticalAlign': 'top'
        })
    ], style={'display': 'flex', 'flexDirection': 'row'})
])

# Callback to update plot and landing position
@app.callback(
    [Output('trajectory-plot', 'figure'),
     Output('landing-output', 'children')],
    Input('go-button', 'n_clicks'),
    [State('ball-speed', 'value'),
     State('launch-angle', 'value'),
     State('horizontal-launch-angle', 'value'),
     State('spin-rate', 'value'),
     State('spin-axis', 'value'),
     State('wind-speed', 'value'),
     State('wind-direction', 'value'),
     State('temperature', 'value'),
     State('humidity', 'value'),
     State('air-pressure', 'value')]
)
def update_trajectory(n_clicks, ball_speed, launch_angle, horizontal_launch_angle, spin_rate, spin_axis,
                      wind_speed, wind_direction, temperature, humidity, air_pressure):
    # Convert inputs to model units
    velocity_mps = ball_speed * 0.44704  # mph to m/s
    windspeed_mps = wind_speed * 0.44704  # mph to m/s
    rho = calculate_air_density(temperature, humidity, air_pressure)
    
    # Initialize golf model
    golf_m = golf_ballstics()
    
    # Simulate shot
    golf_m.initiate_hit(
        velocity=velocity_mps,
        launch_angle_deg=launch_angle,
        horizontal_launch_angle_deg=horizontal_launch_angle,
        spin_rpm=spin_rate,
        spin_angle_deg=spin_axis,
        windspeed=windspeed_mps,
        windheading_deg=wind_direction,
        rho=rho,
        mass=0.0455,
        radius=0.0213,
        g=9.81
    )
    
    # Get simulation results
    df = golf_m.df_simres
    



    # Filter points where z >= 0
    df_plot = df[df['z'] >= 0]
    
    # Create 3D line plot for trajectory
    trace = go.Scatter3d(
        x=df_plot['x'],
        y=df_plot['y'],
        z=df_plot['z'],
        mode='lines',
        line=dict(
            color='darkblue',
            width=2
        ),
        name='Trajectory'
    )
    
    # Starting point marker
    start_trace = go.Scatter3d(
        x=[0],
        y=[0],
        z=[0],
        mode='markers',
        marker=dict(
            color='green',
            size=5,
            symbol='circle'
        ),
        name='Tee'
    )
    
    # Get landing position
    x_m, y_m, err = golf_m.get_landingpos(
        check=True,
        velocity=velocity_mps,
        launch_angle_deg=launch_angle,
        horizontal_launch_angle_deg=horizontal_launch_angle,
        spin_rpm=spin_rate,
        spin_angle_deg=spin_axis,
        windspeed=windspeed_mps,
        windheading_deg=wind_direction,
        rho=rho
    )
    
    # Landing point marker
    landing_trace = go.Scatter3d(
        x=[x_m],
        y=[y_m],
        z=[0],
        mode='markers',
        marker=dict(
            color='red',
            size=5,
            symbol='x'
        ),
        name='Landing Point'
    )
    
    # Set plot ranges
    abs_x = max(abs(df_plot['x'].min()), abs(df_plot['x'].max()))
    y_max = max(df_plot['y']) * 1.2
    z_max = max(max(df_plot['z']) * 1.3,2)
    
    # Define scene
    scene = dict(
        xaxis=dict(
            gridcolor='rgb(255, 255, 255)',
            zerolinecolor='rgb(255, 255, 255)',
            showbackground=True,
            backgroundcolor='rgb(165, 210, 247)',
            range=[-abs_x - 5, abs_x + 5],
            title='x (m)'
        ),
        yaxis=dict(
            gridcolor='rgb(255, 255, 255)',
            zerolinecolor='rgb(255, 255, 255)',
            showbackground=True,
            backgroundcolor='rgb(165, 210, 247)',
            range=[0, y_max],
            title='y (m)'
        ),
        zaxis=dict(
            gridcolor='rgb(255, 255, 255)',
            zerolinecolor='rgb(255, 255, 255)',
            showbackground=True,
            backgroundcolor='#006747',
            range=[0, z_max],
            title='z (m)'
        ),
        aspectratio=dict(x=1, y=2.5, z=1),
        camera=dict(eye=dict(x=-2.2, y=0.2, z=0.3))
    )
    
    # Create figure
    fig = go.Figure(data=[start_trace, trace, landing_trace])
    fig.update_layout(
        title='Golf Ball Trajectory',
        showlegend=False,
        margin={'t': 50},
        scene=scene
    )
    
    # Calculate metrics
    x_yd = x_m * 1.09361
    y_yd = y_m * 1.09361
    max_z_m = df_plot['z'].max()
    max_z_ft = max_z_m * 1.09361 * 3
    length_yd = np.sqrt(x_yd**2 + y_yd**2)
    
    
    # Calculate curvature
    # Straight path lateral position based on horizontal launch angle
    x_straight_yd = y_yd * np.tan(np.deg2rad(horizontal_launch_angle))
    # Curvature as the deviation from the straight path
    curvature_ft = (x_yd - x_straight_yd) *3


    # Prepare landing output
    landing_output = html.Ul([
        html.Li(f"Carry: {y_yd:.2f} yd"),
        html.Li(f"Lateral: {x_yd:.2f} yd"),
        html.Li(f"Height: {max_z_ft:.2f} ft"),
        #html.Li(f"Total Distance: {length_yd:.2f} yd"),
        html.Li(f"Curvature: {curvature_ft:.2f} yd"),
        html.Li(f"Error: {err}" if err else "Error: None")
    ])
    
    return fig, landing_output
'''
Noticed that sometimes the trajectory doesnt end up where the calculated value displays. No idea why yet
'''
# Run the app
if __name__ == '__main__':
    app.run(debug=True)