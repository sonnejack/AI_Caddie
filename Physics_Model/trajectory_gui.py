import numpy as np
import pandas as pd
from scipy.optimize import differential_evolution
import tkinter as tk
from tkinter import ttk, filedialog
import matplotlib.pyplot as plt
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
import os

def huber_loss(delta, error):
    """
    Custom Huber loss function to handle outliers.
    
    Args:
        delta (float): Threshold for quadratic-to-linear transition.
        error (float): Prediction error.
    
    Returns:
        float: Huber loss value.
    """
    if abs(error) <= delta:
        return 0.5 * error**2
    return delta * abs(error) - 0.5 * delta**2

def adjust_trajectory(ball_speed_mph, launch_angle_deg, spin_rate_rpm, spin_axis_deg, launch_direction_deg,
                     wind_speed_mph, wind_direction_deg, temperature_f, humidity_percent, altitude_ft,
                     C_d_base, C_d_v, C_l_scale, spin_decay_rate, side_spin_scale):
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
        C_d_base (float): Base drag coefficient.
        C_d_v (float): Velocity-dependent drag coefficient factor.
        C_l_scale (float): Lift coefficient scale (C_l = scale * spin_rpm / v_mag).
        spin_decay_rate (float): Spin decay rate per second (fraction).
        side_spin_scale (float): Side spin scaling factor.
    
    Returns:
        tuple: (carry_yards, side_ft, max_height_ft, trajectory_points)
    """
    # Constants
    g = 9.81  # Gravity (m/s^2)
    ball_mass_kg = 0.04593  # Golf ball mass (kg)
    ball_radius_m = 0.021335  # Golf ball radius (m)
    A = np.pi * ball_radius_m**2  # Cross-sectional area (m^2)
    
    # Convert inputs to SI units
    ball_speed_ms = ball_speed_mph * 0.44704
    launch_angle_rad = np.radians(launch_angle_deg)
    launch_direction_rad = np.radians(launch_direction_deg)
    spin_axis_rad = np.radians(spin_axis_deg)
    backspin_rpm = spin_rate_rpm * np.abs(np.cos(spin_axis_rad))
    sidespin_rpm = spin_rate_rpm * np.sin(spin_axis_rad) * side_spin_scale
    
    # Initial velocity components
    v_x = ball_speed_ms * np.cos(launch_angle_rad)
    v_y = ball_speed_ms * np.sin(launch_angle_rad)
    v_z = ball_speed_ms * np.sin(launch_direction_rad) * np.cos(launch_angle_rad)
    
    # Air density (kg/m^3)
    temp_c = (temperature_f - 32) * 5/9
    pressure_mb = 1013.25 * np.exp(-0.00012 * altitude_ft * 0.3048)
    rho = 1.225 * (pressure_mb / 1013.25) * (288.15 / (temp_c + 273.15)) * (1 - 0.01 * humidity_percent / 100)
    
    # Time step
    dt = 0.01
    t = 0
    x, y, z = 0, 0, 0
    max_height_m = 0
    trajectory_points = [(x, y, z)]
    
    # Simulate trajectory
    while y >= 0:
        # Update spin
        current_backspin_rpm = backspin_rpm * np.exp(-spin_decay_rate * t)
        current_sidespin_rpm = sidespin_rpm * np.exp(-spin_decay_rate * t)
        
        # Relative velocity
        v_mag = np.sqrt(v_x**2 + v_y**2 + v_z**2)
        wind_x_ms = wind_speed_mph * 0.44704 * np.cos(np.radians(wind_direction_deg))
        wind_z_ms = wind_speed_mph * 0.44704 * np.sin(np.radians(wind_direction_deg))
        v_rel_x = v_x - wind_x_ms
        v_rel_z = v_z - wind_z_ms
        v_rel_mag = np.sqrt(v_rel_x**2 + v_y**2 + v_rel_z**2)
        
        # Drag force
        C_d = C_d_base + C_d_v * v_rel_mag
        F_d = 0.5 * rho * C_d * A * v_rel_mag**2
        F_d_x = -F_d * v_rel_x / v_rel_mag if v_rel_mag > 0 else 0
        F_d_y = -F_d * v_y / v_rel_mag if v_rel_mag > 0 else 0
        F_d_z = -F_d * v_rel_z / v_rel_mag if v_rel_mag > 0 else 0
        
        # Lift force
        C_l = C_l_scale * current_backspin_rpm / v_rel_mag if v_rel_mag > 0 else 0
        F_l = 0.5 * rho * C_l * A * v_rel_mag**2
        F_l_y = F_l
        F_l_z = 0.5 * rho * C_l * A * v_rel_mag * current_sidespin_rpm / 1000
        
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
        trajectory_points.append((x, y, z))
        t += dt
    
    return (x * 1.09361, z * 3.28084, max_height_m * 3.28084, trajectory_points)

def objective_function(coefficients, df, sample_frac=0.5):
    """
    Compute Huber loss on a sample of shots.
    
    Args:
        coefficients (list): [C_d_base, C_d_v, C_l_scale, spin_decay_rate, side_spin_scale]
        df (pd.DataFrame): Input data
        sample_frac (float): Fraction of data to sample
    
    Returns:
        float: Mean Huber loss
    """
    C_d_base, C_d_v, C_l_scale, spin_decay_rate, side_spin_scale = coefficients
    sample_df = df.sample(frac=sample_frac, random_state=42)
    loss = 0
    n = len(sample_df)
    
    for _, row in sample_df.iterrows():
        carry_pred, side_pred, height_pred, _ = adjust_trajectory(
            row['Ball (mph)'], row['Launch V (deg)'], row['Spin (rpm)'], row['Spin Axis (deg)'],
            row['Launch H (deg)'], row['Wind Speed (mph)'], row['Wind Direction (deg)'],
            row['Temperature (F)'], row['Humidity (%)'], 0,
            C_d_base, C_d_v, C_l_scale, spin_decay_rate, side_spin_scale
        )
        loss += huber_loss(5.0, carry_pred - row['Carry (yd)'])
        loss += huber_loss(5.0, side_pred - row['Lateral (yd)'] * 3.28084)
        loss += huber_loss(5.0, height_pred - row['Height (ft)'])
    
    return loss / (3 * n)

class GolfTrajectoryGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("Golf Trajectory Optimizer")
        self.df = None
        self.coefficients = [0.25, 0.002, 0.00003, 0.01, 1.0]  # Initial [C_d_base, C_d_v, C_l_scale, spin_decay_rate, side_spin_scale]
        
        # Load data
        self.data_path = "/Users/jacksonne/Python Projects/AI_Caddie/AI_Caddie/Shot_Data/random_flightscope_data.csv"
        self.load_data()
        
        # GUI layout
        self.create_input_panel()
        self.create_output_panel()
        self.create_coefficient_panel()
        self.create_plot_panel()
        self.create_control_panel()
    
    def load_data(self):
        """Load and preprocess CSV data."""
        if os.path.exists(self.data_path):
            self.df = pd.read_csv(self.data_path)
            self.df = self.df[self.df['Height (ft)'] <= 300].copy()
            for col in ['Ball (mph)', 'Launch V (deg)', 'Launch H (deg)', 'Spin (rpm)', 'Spin Axis (deg)',
                        'Wind Speed (mph)', 'Wind Direction (deg)', 'Temperature (F)', 'Humidity (%)',
                        'Carry (yd)', 'Lateral (yd)', 'Height (ft)']:
                self.df[col] = pd.to_numeric(self.df[col], errors='coerce').fillna(0.0)
            print(f"Loaded {len(self.df)} rows from {self.data_path}")
        else:
            print(f"Error: {self.data_path} not found.")
    
    def create_input_panel(self):
        """Create input panel for shot parameters."""
        self.input_frame = ttk.LabelFrame(self.root, text="Shot Parameters")
        self.input_frame.grid(row=0, column=0, padx=5, pady=5, sticky="nsew")
        
        labels = ['Ball Speed (mph)', 'Launch V (deg)', 'Launch H (deg)', 'Spin (rpm)', 'Spin Axis (deg)']
        self.input_entries = {}
        for i, label in enumerate(labels):
            ttk.Label(self.input_frame, text=label).grid(row=i, column=0, padx=5, pady=2)
            self.input_entries[label] = ttk.Entry(self.input_frame)
            self.input_entries[label].grid(row=i, column=1, padx=5, pady=2)
        
        # Fixed environmental parameters
        ttk.Label(self.input_frame, text="Wind Speed (mph)").grid(row=5, column=0, padx=5, pady=2)
        self.input_entries['Wind Speed (mph)'] = ttk.Entry(self.input_frame, state='disabled')
        self.input_entries['Wind Speed (mph)'].grid(row=5, column=1, padx=5, pady=2)
        self.input_entries['Wind Speed (mph)'].insert(0, "0")
        
        ttk.Label(self.input_frame, text="Wind Direction (deg)").grid(row=6, column=0, padx=5, pady=2)
        self.input_entries['Wind Direction (deg)'] = ttk.Entry(self.input_frame, state='disabled')
        self.input_entries['Wind Direction (deg)'].grid(row=6, column=1, padx=5, pady=2)
        self.input_entries['Wind Direction (deg)'].insert(0, "0")
        
        ttk.Label(self.input_frame, text="Temperature (F)").grid(row=7, column=0, padx=5, pady=2)
        self.input_entries['Temperature (F)'] = ttk.Entry(self.input_frame, state='disabled')
        self.input_entries['Temperature (F)'].grid(row=7, column=1, padx=5, pady=2)
        self.input_entries['Temperature (F)'].insert(0, "77")
        
        ttk.Label(self.input_frame, text="Humidity (%)").grid(row=8, column=0, padx=5, pady=2)
        self.input_entries['Humidity (%)'] = ttk.Entry(self.input_frame, state='disabled')
        self.input_entries['Humidity (%)'].grid(row=8, column=1, padx=5, pady=2)
        self.input_entries['Humidity (%)'].insert(0, "50")
        
        ttk.Label(self.input_frame, text="Altitude (ft)").grid(row=9, column=0, padx=5, pady=2)
        self.input_entries['Altitude (ft)'] = ttk.Entry(self.input_frame, state='disabled')
        self.input_entries['Altitude (ft)'].grid(row=9, column=1, padx=5, pady=2)
        self.input_entries['Altitude (ft)'].insert(0, "0")
        
        # Shot selection
        ttk.Label(self.input_frame, text="Select Shot").grid(row=10, column=0, padx=5, pady=2)
        self.shot_var = tk.StringVar()
        self.shot_dropdown = ttk.Combobox(self.input_frame, textvariable=self.shot_var, state='readonly')
        self.shot_dropdown.grid(row=10, column=1, padx=5, pady=2)
        if self.df is not None:
            self.shot_dropdown['values'] = [f"Shot {int(row['No.'])}" for _, row in self.df.iterrows()]
        self.shot_dropdown.bind('<<ComboboxSelected>>', self.load_shot)
        
        ttk.Button(self.input_frame, text="Clear Inputs", command=self.clear_inputs).grid(row=11, column=0, columnspan=2, pady=5)
    
    def create_output_panel(self):
        """Create output panel for predictions and actuals."""
        self.output_frame = ttk.LabelFrame(self.root, text="Results")
        self.output_frame.grid(row=0, column=1, padx=5, pady=5, sticky="nsew")
        
        self.output_labels = {}
        for i, label in enumerate(['Predicted Carry (yd)', 'Predicted Lateral (ft)', 'Predicted Height (ft)',
                                  'Actual Carry (yd)', 'Actual Lateral (ft)', 'Actual Height (ft)',
                                  'Error Carry (yd)', 'Error Lateral (ft)', 'Error Height (ft)']):
            ttk.Label(self.output_frame, text=label).grid(row=i, column=0, padx=5, pady=2)
            self.output_labels[label] = ttk.Label(self.output_frame, text="N/A")
            self.output_labels[label].grid(row=i, column=1, padx=5, pady=2)
    
    def create_coefficient_panel(self):
        """Create coefficient adjustment panel."""
        self.coeff_frame = ttk.LabelFrame(self.root, text="Coefficients")
        self.coeff_frame.grid(row=1, column=0, padx=5, pady=5, sticky="nsew")
        
        labels = ['C_d_base', 'C_d_v', 'C_l_scale', 'spin_decay_rate', 'side_spin_scale']
        self.coeff_entries = {}
        for i, label in enumerate(labels):
            ttk.Label(self.coeff_frame, text=label).grid(row=i, column=0, padx=5, pady=2)
            self.coeff_entries[label] = ttk.Entry(self.coeff_frame)
            self.coeff_entries[label].grid(row=i, column=1, padx=5, pady=2)
            self.coeff_entries[label].insert(0, str(self.coefficients[i]))
        
        ttk.Button(self.coeff_frame, text="Update Coefficients", command=self.update_coefficients).grid(row=len(labels), column=0, columnspan=2, pady=5)
        ttk.Button(self.coeff_frame, text="Reset Coefficients", command=self.reset_coefficients).grid(row=len(labels)+1, column=0, columnspan=2, pady=5)
    
    def create_plot_panel(self):
        """Create plot panel for trajectories and errors."""
        self.plot_frame = ttk.LabelFrame(self.root, text="Trajectory and Errors")
        self.plot_frame.grid(row=1, column=1, padx=5, pady=5, sticky="nsew")
        
        self.fig, (self.ax1, self.ax2) = plt.subplots(1, 2, figsize=(10, 4))
        self.canvas = FigureCanvasTkAgg(self.fig, master=self.plot_frame)
        self.canvas.get_tk_widget().pack(fill=tk.BOTH, expand=True)
    
    def create_control_panel(self):
        """Create control panel for actions."""
        self.control_frame = ttk.LabelFrame(self.root, text="Controls")
        self.control_frame.grid(row=2, column=0, columnspan=2, padx=5, pady=5, sticky="nsew")
        
        ttk.Button(self.control_frame, text="Run Prediction", command=self.run_prediction).grid(row=0, column=0, padx=5, pady=5)
        ttk.Button(self.control_frame, text="Optimize Coefficients", command=self.optimize_coefficients).grid(row=0, column=1, padx=5, pady=5)
        ttk.Button(self.control_frame, text="Save Results", command=self.save_results).grid(row=0, column=2, padx=5, pady=5)
    
    def load_shot(self, event):
        """Load selected shot from CSV."""
        if self.df is None:
            return
        shot_str = self.shot_var.get()
        shot_num = int(shot_str.split()[-1])
        row = self.df[self.df['No.'] == shot_num].iloc[0]
        
        self.input_entries['Ball Speed (mph)'].delete(0, tk.END)
        self.input_entries['Ball Speed (mph)'].insert(0, str(row['Ball (mph)']))
        self.input_entries['Launch V (deg)'].delete(0, tk.END)
        self.input_entries['Launch V (deg)'].insert(0, str(row['Launch V (deg)']))
        self.input_entries['Launch H (deg)'].delete(0, tk.END)
        self.input_entries['Launch H (deg)'].insert(0, str(row['Launch H (deg)']))
        self.input_entries['Spin (rpm)'].delete(0, tk.END)
        self.input_entries['Spin (rpm)'].insert(0, str(row['Spin (rpm)']))
        self.input_entries['Spin Axis (deg)'].delete(0, tk.END)
        self.input_entries['Spin Axis (deg)'].insert(0, str(row['Spin Axis (deg)']))
        
        self.output_labels['Actual Carry (yd)'].config(text=f"{row['Carry (yd)']:.1f}")
        self.output_labels['Actual Lateral (ft)'].config(text=f"{row['Lateral (yd)'] * 3.28084:.1f}")
        self.output_labels['Actual Height (ft)'].config(text=f"{row['Height (ft)']:.1f}")
    
    def clear_inputs(self):
        """Clear input fields."""
        for label in ['Ball Speed (mph)', 'Launch V (deg)', 'Launch H (deg)', 'Spin (rpm)', 'Spin Axis (deg)']:
            self.input_entries[label].delete(0, tk.END)
        for label in ['Actual Carry (yd)', 'Actual Lateral (ft)', 'Actual Height (ft)',
                      'Predicted Carry (yd)', 'Predicted Lateral (ft)', 'Predicted Height (ft)',
                      'Error Carry (yd)', 'Error Lateral (ft)', 'Error Height (ft)']:
            self.output_labels[label].config(text="N/A")
    
    def update_coefficients(self):
        """Update coefficients from entry fields."""
        try:
            self.coefficients = [
                float(self.coeff_entries['C_d_base'].get()),
                float(self.coeff_entries['C_d_v'].get()),
                float(self.coeff_entries['C_l_scale'].get()),
                float(self.coeff_entries['spin_decay_rate'].get()),
                float(self.coeff_entries['side_spin_scale'].get())
            ]
        except ValueError:
            print("Invalid coefficient values.")
    
    def reset_coefficients(self):
        """Reset coefficients to initial values."""
        self.coefficients = [0.25, 0.002, 0.00003, 0.01, 1.0]
        for i, label in enumerate(['C_d_base', 'C_d_v', 'C_l_scale', 'spin_decay_rate', 'side_spin_scale']):
            self.coeff_entries[label].delete(0, tk.END)
            self.coeff_entries[label].insert(0, str(self.coefficients[i]))
    
    def run_prediction(self):
        """Run prediction and update outputs/plots."""
        try:
            inputs = {
                'Ball Speed (mph)': float(self.input_entries['Ball Speed (mph)'].get()),
                'Launch V (deg)': float(self.input_entries['Launch V (deg)'].get()),
                'Launch H (deg)': float(self.input_entries['Launch H (deg)'].get()),
                'Spin (rpm)': float(self.input_entries['Spin (rpm)'].get()),
                'Spin Axis (deg)': float(self.input_entries['Spin Axis (deg)'].get()),
                'Wind Speed (mph)': 0,
                'Wind Direction (deg)': 0,
                'Temperature (F)': 77,
                'Humidity (%)': 50,
                'Altitude (ft)': 0
            }
        except ValueError:
            print("Invalid input values.")
            return
        
        carry_pred, side_pred, height_pred, traj_points = adjust_trajectory(
            inputs['Ball Speed (mph)'], inputs['Launch V (deg)'], inputs['Spin (rpm)'],
            inputs['Spin Axis (deg)'], inputs['Launch H (deg)'], inputs['Wind Speed (mph)'],
            inputs['Wind Direction (deg)'], inputs['Temperature (F)'], inputs['Humidity (%)'],
            inputs['Altitude (ft)'], *self.coefficients
        )
        
        self.output_labels['Predicted Carry (yd)'].config(text=f"{carry_pred:.1f}")
        self.output_labels['Predicted Lateral (ft)'].config(text=f"{side_pred:.1f}")
        self.output_labels['Predicted Height (ft)'].config(text=f"{height_pred:.1f}")
        
        # Compute errors if actuals are available
        try:
            actual_carry = float(self.output_labels['Actual Carry (yd)'].cget("text"))
            actual_side = float(self.output_labels['Actual Lateral (ft)'].cget("text"))
            actual_height = float(self.output_labels['Actual Height (ft)'].cget("text"))
            self.output_labels['Error Carry (yd)'].config(text=f"{carry_pred - actual_carry:.1f}")
            self.output_labels['Error Lateral (ft)'].config(text=f"{side_pred - actual_side:.1f}")
            self.output_labels['Error Height (ft)'].config(text=f"{height_pred - actual_height:.1f}")
        except ValueError:
            pass
        
        # Plot trajectory
        self.ax1.clear()
        self.ax2.clear()
        x, y, z = zip(*traj_points)
        x_yd = [xi * 1.09361 for xi in x]
        y_ft = [yi * 3.28084 for yi in y]
        z_ft = [zi * 3.28084 for zi in z]
        
        self.ax1.plot(x_yd, y_ft)
        self.ax1.set_xlabel('Carry (yd)')
        self.ax1.set_ylabel('Height (ft)')
        self.ax1.set_title('Side View')
        
        self.ax2.plot(x_yd, z_ft)
        self.ax2.set_xlabel('Carry (yd)')
        self.ax2.set_ylabel('Lateral (ft)')
        self.ax2.set_title('Top View')
        
        self.fig.tight_layout()
        self.canvas.draw()
    
    def optimize_coefficients(self):
        """Optimize coefficients using differential evolution."""
        if self.df is None:
            print("No data loaded for optimization.")
            return
        
        bounds = [(0.1, 0.5), (0.0, 0.01), (1e-6, 1e-4), (0.0, 0.05), (0.5, 2.0)]
        result = differential_evolution(
            objective_function,
            bounds,
            args=(self.df, 0.5),
            maxiter=500,
            popsize=15
        )
        
        if result.success:
            self.coefficients = result.x
            print(f"Optimized Coefficients: C_d_base={result.x[0]:.4f}, C_d_v={result.x[1]:.6f}, "
                  f"C_l_scale={result.x[2]:.6f}, spin_decay_rate={result.x[3]:.4f}, side_spin_scale={result.x[4]:.4f}")
            print(f"Final Huber Loss: {result.fun:.2f}")
            
            for i, label in enumerate(['C_d_base', 'C_d_v', 'C_l_scale', 'spin_decay_rate', 'side_spin_scale']):
                self.coeff_entries[label].delete(0, tk.END)
                self.coeff_entries[label].insert(0, str(self.coefficients[i]))
            
            # Evaluate RMSE
            mse_carry, mse_side, mse_height = 0, 0, 0
            n = len(self.df)
            for _, row in self.df.iterrows():
                carry_pred, side_pred, height_pred, _ = adjust_trajectory(
                    row['Ball (mph)'], row['Launch V (deg)'], row['Spin (rpm)'], row['Spin Axis (deg)'],
                    row['Launch H (deg)'], row['Wind Speed (mph)'], row['Wind Direction (deg)'],
                    row['Temperature (F)'], row['Humidity (%)'], 0,
                    *self.coefficients
                )
                mse_carry += (carry_pred - row['Carry (yd)'])**2
                mse_side += (side_pred - row['Lateral (yd)'] * 3.28084)**2
                mse_height += (height_pred - row['Height (ft)'])**2
            
            mse_carry /= n
            mse_side /= n
            mse_height /= n
            print(f"Model Performance (RMSE):")
            print(f"Carry (yd): RMSE = {np.sqrt(mse_carry):.2f}")
            print(f"Lateral (ft): RMSE = {np.sqrt(mse_side):.2f}")
            print(f"Height (ft): RMSE = {np.sqrt(mse_height):.2f}")
        else:
            print(f"Optimization failed: {result.message}")
    
    def save_results(self):
        """Save current results to a file."""
        file_path = filedialog.asksaveasfilename(defaultextension=".txt")
        if file_path:
            with open(file_path, 'w') as f:
                f.write("Coefficients:\n")
                for label, value in zip(['C_d_base', 'C_d_v', 'C_l_scale', 'spin_decay_rate', 'side_spin_scale'], self.coefficients):
                    f.write(f"{label}: {value:.6f}\n")
                f.write("\nLast Prediction:\n")
                for label in ['Predicted Carry (yd)', 'Predicted Lateral (ft)', 'Predicted Height (ft)',
                              'Actual Carry (yd)', 'Actual Lateral (ft)', 'Actual Height (ft)',
                              'Error Carry (yd)', 'Error Lateral (ft)', 'Error Height (ft)']:
                    f.write(f"{label}: {self.output_labels[label].cget('text')}\n")

if __name__ == "__main__":
    root = tk.Tk()
    app = GolfTrajectoryGUI(root)
    root.mainloop()