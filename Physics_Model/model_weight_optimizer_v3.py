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
        
        # Aerodynamic properties (optimized 6/29/2025 6:25 pm)
        self.C_d0 = 0.1664  # Base drag coefficient
        self.C_d1 = 0.2990  # Spin-dependent drag coefficient
        self.C_d2 = 0.0500  # Reynolds-dependent drag coefficient
        self.C_d4 = 0.0256  # Spin axis drag adjustment
        self.C_l2 = 0.0     # Reynolds-dependent lift adjustment
        self.C_l4 = 0.0198  # Spin axis lift adjustment
        
        # Curvature scaling parameters
        self.a = -0.0578
        self.b = 0.8388
        self.p = 0.500
        
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
        self.horizontal_launch_angle_deg = None
        self.windspeed = None
        
        # ODE solver parameters
        self.endtime = 10
        self.timesteps = 100
        
        # Simulation results storage
        self.simres = None
        self.df_simres = pd.DataFrame(columns=['t', 'x', 'y', 'z', 'v_x', 'v_y', 'v_z', 'omega'])
        
        # Aerodynamic coefficient data
        self.sn_Cl = [[0, 0.04, 0.1, 0.2, 0.4], [0, 0.1, 0.16, 0.23, 0.33]]

    def initiate_hit(self, velocity, launch_angle_deg, horizontal_launch_angle_deg, 
                     spin_rpm, spin_angle_deg, windspeed, windheading_deg,  
                     mass=0.0455, radius=0.0213, rho=1.225, g=9.81):
        self.mass = mass
        self.radius = radius
        self.rho = rho
        self.g = g
        self.horizontal_launch_angle_deg = horizontal_launch_angle_deg
        self.windspeed = windspeed
        self.spin = spin_rpm / 60
        self.spin_angle = spin_angle_deg / 180 * np.pi
        
        theta = launch_angle_deg / 180 * np.pi
        psi = horizontal_launch_angle_deg / 180 * np.pi
        self.velocity = velocity * np.array([
            np.cos(theta) * np.sin(psi),
            np.cos(theta) * np.cos(psi),
            np.sin(theta)
        ])
        
        windheading = windheading_deg / 180 * np.pi
        self.windvelocity = windspeed * np.array([
            np.sin(windheading),
            np.cos(windheading),
            0
        ])
        
        self.simulate()
    
    def get_landingpos(self, check=False, curvature_scale_params=None, *args, **kwargs):
        if curvature_scale_params is None:
            a, b, p = self.a, self.b, self.p
        else:
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
            
            y_yd = y * 1.09361
            x_yd = x * 1.09361
            psi = self.horizontal_launch_angle_deg * np.pi / 180
            x_straight_yd = y_yd * np.tan(psi)
            curvature_yd = x_yd - x_straight_yd
            
            if abs(self.spin_angle) < 1e-6 and abs(self.windspeed) < 1e-6:
                x_adjusted_yd = x_straight_yd
            else:
                scale = a * (abs(curvature_yd) ** p) + b
                scale = max(0.1, min(scale, 2.0))
                scaled_curvature_yd = curvature_yd * scale
                x_adjusted_yd = x_straight_yd + scaled_curvature_yd
            
            x_adjusted = x_adjusted_yd / 1.09361
        else:
            x_adjusted, y = 0, 0
        
        if check:
            return x_adjusted, y, err
        return x_adjusted, y
    
    def set_params(self, params_list, param_order):
        for key, value in zip(param_order, params_list):
            setattr(self, key, value)
    
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
        domega_dt = 0
        return [vx, vy, vz, dvxdt, dvydt, dvzdt, domega_dt]
    
    def simulate(self):
        self.df_simres['t'] = np.linspace(0, self.endtime, self.timesteps)
        v0 = [0, 0, 0, self.velocity[0], self.velocity[1], self.velocity[2], self.spin]
        self.simres = odeint(self.model, v0, self.df_simres['t'])
        self.df_simres['x'] = self.simres[:, 0]
        self.df_simres['y'] = self.simres[:, 1]
        self.df_simres['z'] = self.simres[:, 2]
        self.df_simres['v_x'] = self.df_simres['v_x'] = self.simres[:, 3]
        self.df_simres['v_y'] = self.simres[:, 4]
        self.df_simres['v_z'] = self.simres[:, 5]
        self.df_simres['omega'] = self.simres[:, 6]

def calculate_air_density(T_f, RH, P_psi):
    T_c = (T_f - 32) * 5 / 9
    T_k = T_c + 273.15
    P_sat = 611.21 * np.exp((18.678 - (T_c / 234.5)) * (T_c / (257.14 + T_c)))
    P_v = (RH / 100) * P_sat
    P_pa = P_psi * 6894.76
    R_d = 287.05
    rho = (P_pa / (R_d * T_k)) * (1 - 0.378 * (P_v / P_pa))
    return rho

# Parameter optimization
param_order = ['C_d0', 'C_d1', 'C_d2', 'C_d4', 'C_l4', 'a', 'b', 'p']
initial_guess = {
    # Aerodynamic properties (optimized 6/29/2025 6:25 pm)
    'C_d0' : 0.1664,  # Base drag coefficient
    'C_d1' : 0.2990,  # Spin-dependent drag coefficient
    'C_d2' : 0.0500,  # Reynolds-dependent drag coefficient
    'C_d4' : 0.0256,  # Spin axis drag adjustment
    'C_l4' : 0.0198,  # Spin axis lift adjustment
    'a': -0.0688,
    'b': 0.8699,
    'p': 0.5047
}
bounds = {
    'C_d0': (0.1, 0.3),
    'C_d1': (0.2, 0.5),
    'C_d2': (0.03, 0.08),
    'C_d4': (0.01, 0.05),
    'C_l4': (0.01, 0.05),
    'a': (-0.1, 0.1),
    'b': (0.1, 1.0),
    'p': (0.5, 2.0)
}
initial_guess_list = [initial_guess[key] for key in param_order]
bounds_list = [bounds[key] for key in param_order]

def objective_function(params_list, df, model, param_order):
    model.set_params(params_list, param_order)
    sim_x = []
    sim_y = []
    actual_x = []
    actual_y = []
    for _, row in df.iterrows():
        velocity_mps = row['Ball Speed (mph)'] * 0.44704
        windspeed_mps = row['Wind Speed (mph)'] * 0.44704
        rho = calculate_air_density(row['Temperature (F)'], row['Humidity (%)'], row['Air Pressure (psi)'])
        x_m, y_m = model.get_landingpos(
            velocity=velocity_mps,
            launch_angle_deg=row['Launch V (deg)'],
            horizontal_launch_angle_deg=row['Launch H (deg)'],
            spin_rpm=row['Spin Rate (rpm)'],
            spin_angle_deg=row['Spin Axis (deg)'],
            windspeed=windspeed_mps,
            windheading_deg=row['Wind Direction (deg)'],
            rho=rho
        )
        sim_x.append(x_m * 1.09361)
        sim_y.append(y_m * 1.09361)
        actual_x.append(row['Lateral (yd)'])
        actual_y.append(row['Carry (yd)'])
    mse = np.mean((np.array(sim_x) - np.array(actual_x))**2 + (np.array(sim_y) - np.array(actual_y))**2)
    return mse

# Load data
file_path = '/Users/jacksonne/Python Projects/AI_Caddie/AI_Caddie/Data_Collection/random_flightscope_data.xlsx'
df = pd.read_excel(file_path)
numeric_columns = [
    'Ball Speed (mph)', 'Spin Rate (rpm)', 'Spin Axis (deg)', 'Launch V (deg)', 
    'Launch H (deg)', 'Wind Speed (mph)', 'Temperature (F)', 'Humidity (%)', 
    'Air Pressure (psi)', 'Carry (yd)', 'Lateral (yd)', 'Height (ft)', 'Wind Direction (deg)'
]
for col in numeric_columns:
    df[col] = pd.to_numeric(df[col], errors='coerce')
df = df.dropna(subset=numeric_columns)

# Initialize model
golf_m = golf_ballstics()

# Run optimization
result = minimize(
    fun=objective_function,
    x0=initial_guess_list,
    args=(df, golf_m, param_order),
    method='L-BFGS-B',
    bounds=bounds_list,
    options={'maxiter': 60, 'disp': True}
)

# Optimal parameters
optimal_params_list = result.x
optimal_params = {key: optimal_params_list[i] for i, key in enumerate(param_order)}
golf_m.set_params(optimal_params_list, param_order)

# Simulate with optimal parameters
sim_carry = []
sim_lateral = []
sim_height = []
actual_carry = []
actual_lateral = []
actual_height = []
for _, row in df.iterrows():
    velocity_mps = row['Ball Speed (mph)'] * 0.44704
    windspeed_mps = row['Wind Speed (mph)'] * 0.44704
    rho = calculate_air_density(row['Temperature (F)'], row['Humidity (%)'], row['Air Pressure (psi)'])
    x_m, y_m = golf_m.get_landingpos(
        velocity=velocity_mps,
        launch_angle_deg=row['Launch V (deg)'],
        horizontal_launch_angle_deg=row['Launch H (deg)'],
        spin_rpm=row['Spin Rate (rpm)'],
        spin_angle_deg=row['Spin Axis (deg)'],
        windspeed=windspeed_mps,
        windheading_deg=row['Wind Direction (deg)'],
        rho=rho
    )
    sim_lateral_yd = x_m * 1.09361
    sim_carry_yd = y_m * 1.09361
    apex_height_m = max(golf_m.df_simres['z'][golf_m.df_simres['z'] >= 0])
    sim_apex_height_ft = apex_height_m * 1.09361 * 3
    sim_carry.append(sim_carry_yd)
    sim_lateral.append(sim_lateral_yd)
    sim_height.append(sim_apex_height_ft)
    actual_carry.append(row['Carry (yd)'])
    actual_lateral.append(row['Lateral (yd)'])
    actual_height.append(row['Height (ft)'])

# Compute statistics
carry_mse = mean_squared_error(actual_carry, sim_carry)
carry_mae = mean_absolute_error(actual_carry, sim_carry)
carry_r2 = r2_score(actual_carry, sim_carry)
lateral_mse = mean_squared_error(actual_lateral, sim_lateral)
lateral_mae = mean_absolute_error(actual_lateral, sim_lateral)
lateral_r2 = r2_score(actual_lateral, sim_lateral)
height_mse = mean_squared_error(actual_height, sim_height)
height_mae = mean_absolute_error(actual_height, sim_height)
height_r2 = r2_score(actual_height, sim_height)

# Print results
print("Optimal Parameters:")
for key, value in optimal_params.items():
    print(f"{key}: {value:.4f}")

print("\nStatistical Summary:")
print(f"Carry MSE: {carry_mse:.4f} (yd²)")
print(f"Carry MAE: {carry_mae:.4f} (yd)")
print(f"Carry R²: {carry_r2:.4f}")
print(f"Lateral MSE: {lateral_mse:.4f} (yd²)")
print(f"Lateral MAE: {lateral_mae:.4f} (yd)")
print(f"Lateral R²: {lateral_r2:.4f}")
print(f"Height MSE: {height_mse:.4f} (ft²)")
print(f"Height MAE: {height_mae:.4f} (ft)")
print(f"Height R²: {height_r2:.4f}")