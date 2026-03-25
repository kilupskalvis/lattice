package simple

// @lattice:flow process-order
func ProcessOrder(id string) {
	validated := validate(id)
	SaveOrder(validated)
}

func validate(id string) string {
	return id
}
