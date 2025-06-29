**File structure:**

*Data_Collection:* 
Folder contains selenium automation script for gathering flightscope data [flightscope_web_automation.py], houses the excel file with the flightscope data [random_flightscope_data.xlsx], and a generated excel file comparing this data to the model [random_flightscope_data_classified.xlsx].
*General:* 
Hosts business idea for the process, a semi-step-by-step plan on steps for building the grand vision, possible ideas to pursue in the future, and any large assumptions or facts that I'm gathering my information from.

*Physics_Model:* 
Folder contains every physics model iteration, generating a plot of all the flightscope data and comparing to the model prediction
v1: used the ballistic model as is (high error)
v2: added plotly plots instead of tkinter for better comparison based on shot type
v3: added spin decay and height as a parameter to optimize from results from [model_weight_optimizer]
v4: turned spin decay to 0, optimize from results from [model_weight_optimizer]
v5: added spin axis effect on drag, optimize from results from [model_weight_optimizer]
v6: added curvature value, created curvature scale, optimize from results from [model_weight_optimizer_v2] 