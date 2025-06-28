import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
import numpy as np
import os

# Define column names
carry_col = 'Carry (yards)'
side_col = 'Carry Side (ft)'
required_cols = ['Player', 'Club', 'Shot Type', carry_col, side_col]

# Error handling: Check if Excel file exists
excel_file = 'AI_caddie_shot_data_test.xlsx'
if not os.path.exists(excel_file):
    print(f"Error: The file '{excel_file}' does not exist.")
    exit(1)

try:
    # Read the Excel file
    df = pd.read_excel(excel_file)
except Exception as e:
    print(f"Error reading Excel file: {e}")
    exit(1)

# Error handling: Check for required columns
missing_cols = [col for col in required_cols if col not in df.columns]
if missing_cols:
    print(f"Error: Missing required columns: {', '.join(missing_cols)}")
    exit(1)

# Filter out non-numeric or NaN values in plotting columns
df = df.dropna(subset=[carry_col, side_col])  # Drop rows with NaN in plotting columns
df = df[pd.to_numeric(df[carry_col], errors='coerce').notnull() & 
        pd.to_numeric(df[side_col], errors='coerce').notnull()]  # Keep only numeric values

# Create a combined tag column for color-coding
try:
    df['tag'] = df['Club'] + ' - ' + df['Shot Type']
except Exception as e:
    print(f"Error creating 'tag' column: {e}")
    exit(1)

# Get unique players
players = df['Player'].unique()

# Define extended marker list for up to 12 players
markers = ['o', 's', '^', 'D', 'v', '<', '>', 'p', 'h', 'x', '*', '+']

# Ensure enough markers for all players
if len(players) > len(markers):
    print(f"Warning: {len(players)} players detected, but only {len(markers)} unique markers available. Some markers may be reused.")
    markers = markers * (len(players) // len(markers) + 1)  # Repeat markers if needed

# Create a single plot if there is valid data
if not df.empty:
    # Calculate global axis limits
    max_carry = df[carry_col].max()
    max_side = df[side_col].abs().max()

    # Check for valid max values
    if pd.isna(max_carry) or pd.isna(max_side):
        print("Warning: Invalid maximum values for axis limits. Using default limits.")
        max_carry = 100  # Default value
        max_side = 50    # Default value

    # Set limits so max value is at 80% of axis
    y_max = max_carry / 0.8
    x_max = max_side / 0.8

    plt.figure(figsize=(12, 8))
    try:
        sns.scatterplot(
            x=side_col,
            y=carry_col,
            hue='tag',          # Color by tag (Club + Shot Type)
            style='Player',     # Different markers for each player
            data=df,
            markers=markers[:len(players)],  # Assign unique markers
            s=100               # Increase marker size for visibility
        )
        plt.axvline(x=0, color='gray', linestyle='--')  # Target line

        # Set axis limits: y-axis starts at 0, x-axis symmetric around 0
        plt.ylim(0, y_max)
        plt.xlim(-x_max, x_max)

        # Enable gridlines
        plt.grid(True, which='both', linestyle='--', alpha=0.7)  # Grid for major ticks

        # Set labels and title
        plt.title('Shot Dispersion for All Players')
        plt.xlabel('Carry Side (ft)')
        plt.ylabel('Carry Distance (yards)')
        plt.legend(bbox_to_anchor=(1.05, 1), loc='upper left', title='Club - Shot Type / Player', ncol=2)  # Two-column legend
        plt.tight_layout()
        plt.show()
    except Exception as e:
        print(f"Error creating scatterplot: {e}")
else:
    print("No valid data to plot. Displaying an empty plot.")
    plt.figure(figsize=(12, 8))
    plt.axvline(x=0, color='gray', linestyle='--')  # Target line
    plt.ylim(0, 100)  # Default y-axis limit
    plt.xlim(-50, 50) # Default x-axis limit
    plt.grid(True, which='both', linestyle='--', alpha=0.7)
    plt.title('Shot Dispersion for All Players')
    plt.xlabel('Carry Side (ft)')
    plt.ylabel('Carry Distance (yards)')
    plt.legend([], bbox_to_anchor=(1.05, 1), loc='upper left', title='Club - Shot Type / Player', ncol=2)  # Empty legend
    plt.tight_layout()
    plt.show()