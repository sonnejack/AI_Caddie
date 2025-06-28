import numpy as np
import pandas as pd
import re
import pyautogui
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.common.exceptions import TimeoutException, NoSuchElementException
import time
import os

def generate_combinations(n):
    """
    Generate n combinations of shot parameters.
    Returns: List of tuples (ball_speed, launch_angle, spin, spin_axis, spin_axis_dir, h_launch, h_launch_dir).
    """
    ball_speeds = np.linspace(110, 180, 50)  # e.g., [50, 100, 150, 200]
    launch_angles = np.linspace(10, 30, 20)  # e.g., [1, 12, 23, 34, 45]
    spins = np.linspace(2000, 8000, 30)   # e.g., [1000, 6500, 12000]
    spin_axes = np.linspace(0, 15, 8)      # e.g., [0, 7.5, 15]
    spin_axis_dirs = ['Left', 'Right']
    h_launches = np.linspace(0, 10, 8)     # e.g., [0, 5, 10]
    h_launch_dirs = ['Left', 'Right']
    
    # Generate all combinations
    combinations = []
    for bs in ball_speeds:
        for la in launch_angles:
            for sp in spins:
                for sa in spin_axes:
                    for sad in spin_axis_dirs:
                        for hl in h_launches:
                            for hld in h_launch_dirs:
                                combinations.append((bs, la, sp, sa, sad, hl, hld))
    
    # Randomly sample n combinations
    if len(combinations) > n:
        indices = np.random.choice(len(combinations), n, replace=False)
        combinations = [combinations[i] for i in indices]
    
    return combinations

def main():
    # Initialize PyAutoGUI
    pyautogui.FAILSAFE = True  # Move mouse to top-left corner to stop script
    pyautogui.PAUSE = 0.1  # Default delay between PyAutoGUI actions

    # Initialize WebDriver
    chromedriver_path = "/Users/jacksonne/Downloads/chromedriver-mac-x64/chromedriver"
    try:
        if not os.path.exists(chromedriver_path):
            raise FileNotFoundError(f"ChromeDriver not found at {chromedriver_path}")
        service = Service(executable_path=chromedriver_path)
        options = Options()
        driver = webdriver.Chrome(service=service, options=options)
        print("ChromeDriver initialized successfully.")
    except Exception as e:
        print(f"Error initializing ChromeDriver: {e}")
        input("Press Enter to exit.")
        exit(1)
    
    wait = WebDriverWait(driver, 20)
    results = []

    try:
        # Navigate to FlightScope Trajectory Optimizer
        driver.get("https://trajectory.flightscope.com")
        time.sleep(1)  # Initial page load
        print("Please manually click the first button (e.g., SVG or 'Standard Sea Level'), complete any setup (e.g., 'Save'), then press Enter to continue.")
        input()
        print("Continuing automation... Click the browser window to ensure it's focused.")
        time.sleep(2)  # Give user time to focus browser
        
        # Generate parameter combinations
        combinations = generate_combinations(200)

        # Save combinations to CSV
        pd.DataFrame(combinations, columns=[
            'ball_speed', 'launch_angle', 'spin', 'spin_axis', 'spin_axis_dir', 'h_launch', 'h_launch_dir'
        ]).to_csv('parameter_combinations.csv', index=False)
        print("Parameter combinations saved to parameter_combinations.csv")

        # Press Tab 11 times to reach Vertical Launch Angle field
        for _ in range(11):                         
            pyautogui.press('tab')

        start_time = time.time()

        for i, (ball_speed, launch_angle, spin, spin_axis, spin_axis_dir, h_launch, h_launch_dir) in enumerate(combinations, 1):
            print(f"Processing combination {i}/{len(combinations)}: "
                  f"Ball Speed={ball_speed:.1f}, Launch Angle={launch_angle:.1f}, Spin={spin:.0f}, "
                  f"Spin Axis={spin_axis:.1f} {spin_axis_dir}, H Launch={h_launch:.1f} {h_launch_dir}")
            iteration_start = time.time()
            # Input Vertical Launch Angle
            #print("Inputting Vertical Launch Angle...")
            pyautogui.write(str(round(launch_angle, 1)))
            time.sleep(0.1)
            # Tab once, input Ball Speed
            pyautogui.press('tab')
            #print("Inputting Ball Speed...")
            pyautogui.write(str(round(ball_speed, 1)))
            time.sleep(0.1)

            # Tab once, input Horizontal Launch Angle
            pyautogui.press('tab')
            #print("Inputting Horizontal Launch Angle...")
            pyautogui.write(str(round(h_launch, 1)))
            time.sleep(0.1) 
            
            # Tab once, input Launch Direction ('L' or 'R')
            pyautogui.press('tab')
            #print("Inputting Launch Direction...")
            pyautogui.write('L' if h_launch_dir == 'Left' else 'R')
            time.sleep(0.1)

            # Tab twice, input Spin
            pyautogui.press('tab')
            pyautogui.press('tab')
            #print("Inputting Spin...")
            pyautogui.write(str(int(spin)))
            time.sleep(0.1)
            # Tab once, input Spin Axis
            pyautogui.press('tab')
            #print("Inputting Spin Axis...")
            pyautogui.write(str(round(spin_axis, 1)))
            time.sleep(0.1)

            # Tab once, input Spin Axis Direction ('L' or 'R')
            pyautogui.press('tab')
            #print("Inputting Spin Axis Direction...")
            pyautogui.write('L' if spin_axis_dir == 'Left' else 'R')
            time.sleep(0.1)
            
            # Tab once, press Enter to display shot
            pyautogui.press('tab')
            print("Submitting shot parameters...")
            pyautogui.press('enter')
            time.sleep(0.5)  # Wait for results to update
            
            
            # Press Shift+Tab 8 times to return to Vertical Launch Angle
            for _ in range(8):
                pyautogui.hotkey('shift', 'tab')
                time.sleep(0.1)
        
            elapsed = time.time() - start_time
            iterations_done = i + 1
            avg_time_per_iter = elapsed / iterations_done
            remaining_iters = len(combinations) - iterations_done
            eta_seconds = remaining_iters * avg_time_per_iter
            eta_formatted = time.strftime("%H:%M:%S", time.gmtime(eta_seconds))
            print(f"Iteration {iterations_done}/{len(combinations)}, ETA: {eta_formatted}")
            time.sleep(0.25) 
                
   
    except Exception as e:
        print(f"Fatal error: {e}")
        print("Pausing for manual intervention. Press Enter to close browser.")
        input()
    
    finally:
        print("Press Enter to close the browser.")
        input()
        driver.quit()

if __name__ == "__main__":
    main()