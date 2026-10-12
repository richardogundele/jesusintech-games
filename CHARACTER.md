# Put yourself in the game (about 5 minutes)

The game uses a stand-in character until you add your own. Mixamo is Adobe's free character library; it needs your Adobe login.

1. Go to **mixamo.com** and sign in.
2. Click **Characters** and search **"suit"**. Pick a man in a suit you like.
3. Download the character itself:
   - Click **Download**
   - Format: **FBX Binary (.fbx)**, Pose: **T-pose**
   - Save it as **`character.fbx`**
4. Click **Animations** and download three moves for that character. For each one:
   - Search the name, click it, tick **In Place** (very important for walk and run)
   - **Download** → Format **FBX Binary**, Skin: **Without Skin**
   - **Idle** (for example "Breathing Idle") → save as **`idle.fbx`**
   - **Walking** → save as **`walk.fbx`**
   - **Running** → save as **`run.fbx`**
5. Put all four files in this folder (create it if it isn't there):

   ```
   jesusintech-games/public/assets/character/
   ```

6. Refresh the game. You'll be walking around as your new character. If a file is missing the game quietly uses the stand-in.

Tip: you can grab a second and third suited character the same way to use for pedestrians later.
