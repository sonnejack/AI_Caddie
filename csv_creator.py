import csv
import random
import math

# Settings
max_angle_deg = 7
max_angle_rad = math.radians(max_angle_deg)
max_distance_pct = 0.05

# Club type and expected carry for each shot type
carry_distances = {
    "driver":   {"stock": 310, "draw": 315, "fade": 303},
    "3 wood":   {"stock": 275, "draw": 280, "fade": 268},
    "5 wood":   {"stock": 255, "draw": 260, "fade": 248},
    "3 iron":   {"stock": 235, "draw": 240, "fade": 228},
    "4 iron":   {"stock": 225, "draw": 230, "fade": 218},
    "5 iron":   {"stock": 210, "draw": 215, "fade": 203},
    "6 iron":   {"stock": 195, "draw": 200, "fade": 188},
    "7 iron":   {"stock": 180, "draw": 185, "fade": 173},
    "8 iron":   {"stock": 165, "draw": 170, "fade": 158},
    "9 iron":   {"stock": 150, "draw": 155, "fade": 143},
}

with open("golf_shots.csv", "w", newline="") as csvfile:
    writer = csv.writer(csvfile)
    writer.writerow(["x", "y", "club", "shot"])

    for club, shot_dict in carry_distances.items():
        for shot_type, carry in shot_dict.items():
            for _ in range(10):
                y = random.uniform(carry * (1-max_distance_pct), carry * (1+max_distance_pct))
                x_max = y * math.tan(max_angle_rad)
                x = random.uniform(-x_max, x_max)
                writer.writerow([round(x, 1), round(y, 1), club.lower(), shot_type.lower()])
