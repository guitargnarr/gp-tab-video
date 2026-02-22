// ExtendScript: Create a simple AE project with a composition
// This runs inside After Effects (via aerender or the app)

// Create a new project
app.newProject();

// Create a comp: 1920x1080, 30fps, 5 seconds
var comp = app.project.items.addComp("Tab Demo", 1920, 1080, 1, 5, 30);

// Add a dark background solid
var bgSolid = comp.layers.addSolid([0.08, 0.08, 0.08], "Background", 1920, 1080, 1, 5);

// Add a text layer with song info
var textLayer = comp.layers.addText("METAL RIFF DEMO v2");
var textProp = textLayer.property("Source Text");
var textDoc = textProp.value;
textDoc.fontSize = 72;
textDoc.fillColor = [1, 1, 1]; // white
textDoc.font = "Helvetica-Bold";
textDoc.justification = ParagraphJustification.CENTER_JUSTIFY;
textProp.setValue(textDoc);

// Center the text
textLayer.property("Position").setValue([960, 200]);

// Add a subtitle
var subLayer = comp.layers.addText("Track 0: Guitar  |  130 BPM  |  100 bars");
var subProp = subLayer.property("Source Text");
var subDoc = subProp.value;
subDoc.fontSize = 36;
subDoc.fillColor = [0.7, 0.7, 0.7]; // light gray
subDoc.font = "Helvetica";
subDoc.justification = ParagraphJustification.CENTER_JUSTIFY;
subProp.setValue(subDoc);
subLayer.property("Position").setValue([960, 300]);

// Add a red "cursor" line (shape layer simulating the tab cursor)
var shapeLayer = comp.layers.addShape();
shapeLayer.name = "Cursor Line";
var shapeGroup = shapeLayer.property("Contents").addProperty("ADBE Vector Group");
var rect = shapeGroup.property("Contents").addProperty("ADBE Vector Shape - Rect");
rect.property("Size").setValue([4, 400]);
var fill = shapeGroup.property("Contents").addProperty("ADBE Vector Graphic - Fill");
fill.property("Color").setValue([1, 0.2, 0.2]); // red
shapeLayer.property("Position").setValue([640, 700]);

// Animate cursor sliding right (simulating tab scroll)
var positionProp = shapeLayer.property("Position");
positionProp.setValueAtTime(0, [200, 700]);
positionProp.setValueAtTime(5, [1720, 700]);

// Add the comp to the render queue
var renderItem = app.project.renderQueue.items.add(comp);

// Set output path
var outputFile = new File("~/Projects/gp-tab-video/ae-demo/output/demo_render.mp4");
renderItem.outputModule(1).file = outputFile;

// Save the project
var projectFile = new File("~/Projects/gp-tab-video/ae-demo/demo_project.aep");
app.project.save(projectFile);
