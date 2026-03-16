Ok so here is the plan. We have a lot of new incoming UI and some features may or may not work. We are getting prepared to add this UI, but the thing is the structure of the UI is going to be different here. We are not touching any of the back end code here — this is purely new UI stuff, so you will only be touching the frontend.

One thing that we would like to mention is that the UI will require to be as optimized as possible with respect to the animations here.

So what is going to happen now is this: the new UI has a bunch of features that need to be added, and the logic for the UI is either created or not created yet. So you will either hook this up with the back end or you won't, and if you won't then you will not do anything — you will not implement the logic for it, got it...

You must adhere to the current front end architecture where every dedicated page is its own folder and has a set of components within it related only to that page and not reused at the root level.
