import pandas as pd
import numpy as np
from scipy.integrate import odeint
from scipy.optimize import minimize
from itertools import groupby
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score

class golf_ballstics:
    """
    Golf ball flight simulation model with optimized aerodynamic coefficients, no spin decay.
    Based on MacDonald and Hanzely (1991), A.J. Smiths (1994), and Kothmann (2007).
    """
    
    def __init__(self):
        # Golf ball properties
        self.mass = None
        self.radius = None
        
        # Aerodynamic properties (initial guesses)
        self.C_d0 = 0.24  # Base drag coefficient
        self.C_d1 = 0.18  # Spin-dependent drag coefficient
        self.C_d2 = 0.05  # Reynolds-dependent drag coefficient
        self.C_l2 = 0.1   # Reynolds-dependent lift adjustment
        
        # Air properties
        self.rho = None
        self.mu = 1.8e-5  # Dynamic viscosity of air (kg/m·s)
        self.Re_crit = 2e5  # Critical Reynolds number
        
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
        
        # Aerodynamic coefficient data
        self.sn_Cl = [[0, 0.04, 0.1, 0.2, 0.4], [0, 0.1, 0.16, 0.23, 0.33]]

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
        windheading = windheading_deg / 180 * np.pi
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
        - y (m): Carry distance
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
    
    def reynolds_number(self, v):
        """Calculate Reynolds number."""
        D = 2 * self.radius
        return self.rho * v * D / self.mu
    
    def Cd(self, v, omega):
        """Drag coefficient with Reynolds number and spin dependence."""
        sn = self.effective_spin(v, omega)
        Re = self.reynolds_number(v)
        cd = self.C_d0 + self.C_d1 * sn + self.C_d2 / (1 + Re / self.Re_crit)
        return cd
    
    def Cl(self, v, omega):
        """Lift coefficient with Reynolds number adjustment."""
        sn = self.effective_spin(v, omega)
        cl = np.interp(x=sn, xp=self.sn_Cl[0], fp=self.sn_Cl[1])
        Re = self.reynolds_number(v)
        cl_adjusted = cl * (1 + self.C_l2 * (Re / self.Re_crit))
        return cl_adjusted
    
    def model(self, state, t):
        """ODE model with no spin decay."""
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

    def optimize_coefficients(self, df, maxiter=100):
        """
        Optimize C_d0, C_d1, C_d2, C_l2 to minimize MSE of carry, lateral, and apex differences.
        Returns optimized coefficients and statistical metrics.
        
        Parameters:
        - df (DataFrame): DataFrame containing shot data
        - maxiter (int): Maximum iterations for optimization
        
        Returns:
        - coeffs (list): Optimal coefficients [C_d0, C_d1, C_d2, C_l2]
        - stats (dict): Statistical metrics (MSE, MAE, R² for carry, lateral, apex)
        """
        def objective_function(coeffs, df, model):
            """Compute MSE for carry, lateral, and apex differences."""
            model.C_d0, model.C_d1, model.C_d2, model.C_l2 = coeffs
            carry_diff = []
            side_diff = []
            apex_diff = []
            sim_carries = []
            sim_laterals = []
            sim_apexes = []
            
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
                
                sim_lateral_yd = x_m * 1.09361
                sim_carry_yd = y_m * 1.09361
                apex_height_m = max(model.df_simres['z'][model.df_simres['z'] >= 0])
                sim_apex_height_ft = apex_height_m * 1.09361 * 3
                
                carry_diff.append(sim_carry_yd - row['Carry (yd)'])
                side_diff.append(sim_lateral_yd - row['Lateral (yd)'])
                apex_diff.append(sim_apex_height_ft - row['Height (ft)'])
                sim_carries.append(sim_carry_yd)
                sim_laterals.append(sim_lateral_yd)
                sim_apexes.append(sim_apex_height_ft)
            
            # Compute MSE (equal weighting for all metrics)
            mse = np.mean(np.square(carry_diff)) + np.mean(np.square(side_diff)) + np.mean(np.square(apex_diff))
            
            # Store simulated values for statistical metrics
            objective_function.sim_carries = sim_carries
            objective_function.sim_laterals = sim_laterals
            objective_function.sim_apexes = sim_apexes
            objective_function.carry_diff = carry_diff
            objective_function.side_diff = side_diff
            objective_function.apex_diff = apex_diff
            
            return mse

        # Initial guess for coefficients
        initial_guess = [self.C_d0, self.C_d1, self.C_d2, self.C_l2]
        
        # Bounds to ensure physically reasonable values
        bounds = [(0.1, 0.5), (0.1, 0.5), (0.0, 0.2), (0.0, 0.1)]
        
        # Run optimization
        result = minimize(
            fun=objective_function,
            x0=initial_guess,
            args=(df, self),
            method='L-BFGS-B',
            bounds=bounds,
            options={'maxiter': maxiter, 'disp': True}
        )
        
        # Update coefficients
        self.C_d0, self.C_d1, self.C_d2, self.C_l2 = result.x
        
        # Compute statistical metrics
        carry_mse = mean_squared_error(df['Carry (yd)'], objective_function.sim_carries)
        side_mse = mean_squared_error(df['Lateral (yd)'], objective_function.sim_laterals)
        apex_mse = mean_squared_error(df['Height (ft)'], objective_function.sim_apexes)
        
        carry_mae = mean_absolute_error(df['Carry (yd)'], objective_function.sim_carries)
        side_mae = mean_absolute_error(df['Lateral (yd)'], objective_function.sim_laterals)
        apex_mae = mean_absolute_error(df['Height (ft)'], objective_function.sim_apexes)
        
        carry_r2 = r2_score(df['Carry (yd)'], objective_function.sim_carries)
        side_r2 = r2_score(df['Lateral (yd)'], objective_function.sim_laterals)
        apex_r2 = r2_score(df['Height (ft)'], objective_function.sim_apexes)
        
        stats = {
            'carry_mse': carry_mse,
            'side_mse': side_mse,
            'apex_mse': apex_mse,
            'carry_mae': carry_mae,
            'side_mae': side_mae,
            'apex_mae': apex_mae,
            'carry_r2': carry_r2,
            'side_r2': side_r2,
            'apex_r2': apex_r2
        }
        
        return result.x, stats

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

# Initialize golf model
golf_m = golf_ballstics()

# Optimize coefficients and get statistics
optimal_coeffs, stats = golf_m.optimize_coefficients(df, maxiter=100)

# Print results
print(f"Optimal coefficients: C_d0={optimal_coeffs[0]:.4f}, C_d1={optimal_coeffs[1]:.4f}, C_d2={optimal_coeffs[2]:.4f}, C_l2={optimal_coeffs[3]:.4f}")
print("\nStatistical Metrics:")
print(f"Carry MSE: {stats['carry_mse']:.4f} (yd²)")
print(f"Side MSE: {stats['side_mse']:.4f} (yd²)")
print(f"Apex MSE: {stats['apex_mse']:.4f} (ft²)")
print(f"Carry MAE: {stats['carry_mae']:.4f} (yd)")
print(f"Side MAE: {stats['side_mae']:.4f} (yd)")
print(f"Apex MAE: {stats['apex_mae']:.4f} (ft)")
print(f"Carry R²: {stats['carry_r2']:.4f}")
print(f"Side R²: {stats['side_r2']:.4f}")
print(f"Apex R²: {stats['apex_r2']:.4f}")